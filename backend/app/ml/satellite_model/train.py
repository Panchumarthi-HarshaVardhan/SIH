import os
import sys
import json
import time
import random
import argparse
import logging
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader
from torch.optim import AdamW

from app.ml.satellite_model.config import (
    CLASS_NAMES,
    NUM_CLASSES,
    NUM_CHANNELS,
    INPUT_BANDS,
    DEFAULT_LR,
    DEFAULT_BATCH_SIZE,
    DEFAULT_EPOCHS,
    DEFAULT_PATIENCE,
    WEIGHT_DECAY,
    TRAIN_MANIFEST_PATH,
    VAL_MANIFEST_PATH,
    TEST_MANIFEST_PATH,
    BEST_MODEL_PATH,
    BEST_MODEL_PT,
    TRAINING_METADATA_JSON,
    MODEL_METADATA_PATH,
    TRAINING_HISTORY_PATH,
    NORMALIZATION_STATS_PATH,
    get_device
)
from app.ml.satellite_model.dataset import (
    MultispectralSatelliteDataset,
    compute_dataset_normalization_stats
)
from app.ml.satellite_model.model import get_model, MultispectralCNN
from app.ml.satellite_model.evaluate import evaluate_model_on_dataset, save_evaluation_reports

logger = logging.getLogger("model_trainer")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")


def set_seed(seed: int = 42) -> None:
    random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def train_classifier(
    train_manifest: str = TRAIN_MANIFEST_PATH,
    val_manifest: str = VAL_MANIFEST_PATH,
    test_manifest: str = TEST_MANIFEST_PATH,
    epochs: int = DEFAULT_EPOCHS,
    batch_size: int = DEFAULT_BATCH_SIZE,
    lr: float = DEFAULT_LR,
    patience: int = DEFAULT_PATIENCE,
    seed: int = 42,
    resume: bool = False,
    checkpoint_out_path: str = BEST_MODEL_PATH,
    metadata_out_path: str = MODEL_METADATA_PATH,
    history_out_path: str = TRAINING_HISTORY_PATH
) -> Dict[str, Any]:
    """
    Executes the 6-band CNN training loop with early stopping and best-model checkpointing.
    """
    set_seed(seed)
    device = get_device()
    logger.info(f"Training on device: {device}")

    # 1. Compute training set normalization statistics
    logger.info("Computing channel-wise training normalization statistics...")
    norm_stats = compute_dataset_normalization_stats(train_manifest)

    # 2. Build datasets and data loaders
    train_dataset = MultispectralSatelliteDataset(
        manifest_path=train_manifest,
        is_train=True,
        normalization_stats=norm_stats
    )
    val_dataset = MultispectralSatelliteDataset(
        manifest_path=val_manifest,
        is_train=False,
        normalization_stats=norm_stats
    )

    logger.info(f"Dataset splits: {len(train_dataset)} train, {len(val_dataset)} validation")

    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True, drop_last=False)
    val_loader = DataLoader(val_dataset, batch_size=batch_size, shuffle=False)

    # 3. Initialize Model, Class-Weighted Loss, Optimizer, and LR Scheduler
    model = get_model(architecture="resnet18", pretrained=True).to(device)

    best_val_f1 = -1.0
    if resume and os.path.exists(BEST_MODEL_PT):
        logger.info(f"Resuming training from checkpoint: {BEST_MODEL_PT}")
        try:
            state = torch.load(BEST_MODEL_PT, map_location=device, weights_only=True)
            model.load_state_dict(state)
            if os.path.exists(TRAINING_METADATA_JSON):
                with open(TRAINING_METADATA_JSON, "r", encoding="utf-8") as mf:
                    meta = json.load(mf)
                    best_val_f1 = float(meta.get("macro_f1", 0.90))
                    logger.info(f"Resumed with previous best Val Macro-F1: {best_val_f1:.4f}")
        except Exception as e:
            logger.warning(f"Could not load checkpoint to resume: {e}")

    class_weights = train_dataset.get_class_weights().to(device)
    logger.info(f"Using class weights: {class_weights.cpu().numpy().tolist()}")

    criterion = nn.CrossEntropyLoss(weight=class_weights)
    optimizer = AdamW(model.parameters(), lr=lr, weight_decay=WEIGHT_DECAY)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs, eta_min=1e-6)

    # 4. Training Loop
    history: List[Dict[str, Any]] = []
    best_epoch = 0
    patience_counter = 0

    os.makedirs(os.path.dirname(checkpoint_out_path), exist_ok=True)
    os.makedirs(os.path.dirname(BEST_MODEL_PT), exist_ok=True)

    start_time = time.time()

    for epoch in range(1, epochs + 1):
        model.train()
        running_loss = 0.0
        correct_train = 0
        total_train = 0

        for inputs, targets, _ in train_loader:
            inputs, targets = inputs.to(device), targets.to(device)

            optimizer.zero_grad()
            outputs = model(inputs)
            loss = criterion(outputs, targets)
            loss.backward()
            optimizer.step()

            running_loss += loss.item() * inputs.size(0)
            preds = torch.argmax(outputs, dim=1)
            correct_train += (preds == targets).sum().item()
            total_train += inputs.size(0)

        epoch_train_loss = running_loss / max(1, total_train)
        epoch_train_acc = correct_train / max(1, total_train)

        # Validation Step
        val_metrics = evaluate_model_on_dataset(model, val_dataset, batch_size=batch_size, device=device)
        epoch_val_acc = val_metrics["accuracy"]
        epoch_val_f1 = val_metrics["macro_f1"]

        # Validation Loss
        model.eval()
        val_loss = 0.0
        with torch.no_grad():
            for inputs, targets, _ in val_loader:
                inputs, targets = inputs.to(device), targets.to(device)
                outputs = model(inputs)
                v_loss = criterion(outputs, targets)
                val_loss += v_loss.item() * inputs.size(0)
        epoch_val_loss = val_loss / max(1, len(val_dataset))

        current_lr = optimizer.param_groups[0]['lr']
        scheduler.step()

        epoch_record = {
            "epoch": epoch,
            "train_loss": round(epoch_train_loss, 4),
            "validation_loss": round(epoch_val_loss, 4),
            "train_accuracy": round(epoch_train_acc, 4),
            "validation_accuracy": round(epoch_val_acc, 4),
            "validation_macro_f1": round(epoch_val_f1, 4),
            "learning_rate": current_lr
        }
        history.append(epoch_record)

        print(
            f"Epoch [{epoch:02d}/{epochs:02d}] | "
            f"Train Loss: {epoch_train_loss:.4f} | Train Acc: {epoch_train_acc*100:.2f}% | "
            f"Val Loss: {epoch_val_loss:.4f} | Val Acc: {epoch_val_acc*100:.2f}% | "
            f"Val Macro-F1: {epoch_val_f1:.4f} | LR: {current_lr:.6f}"
        )

        # Checkpoint Best Model based on Validation Macro-F1
        if epoch_val_f1 > best_val_f1:
            best_val_f1 = epoch_val_f1
            best_epoch = epoch
            patience_counter = 0

            # Save state dict to both canonical checkpoints
            torch.save(model.state_dict(), BEST_MODEL_PT)
            if checkpoint_out_path != BEST_MODEL_PT:
                torch.save(model.state_dict(), checkpoint_out_path)

            # Save model metadata
            metadata = {
                "model_architecture": "MultispectralResNet18",
                "model_name": "Sentinel-2 6-Band Adapted ResNet-18",
                "model_version": "1.0",
                "class_names": CLASS_NAMES,
                "class_to_index": {name: idx for idx, name in enumerate(CLASS_NAMES)},
                "input_shape": [NUM_CHANNELS, 128, 128],
                "band_order": INPUT_BANDS,
                "normalization": norm_stats,
                "epoch": best_epoch,
                "best_validation_loss": round(epoch_val_loss, 4),
                "best_validation_accuracy": round(epoch_val_acc, 4),
                "precision": round(val_metrics.get("macro_precision", 0.0), 4),
                "recall": round(val_metrics.get("macro_recall", 0.0), 4),
                "macro_f1": round(best_val_f1, 4),
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "dataset_counts": {
                    "train": len(train_dataset),
                    "validation": len(val_dataset),
                    "test": 146,
                    "class_distribution": train_dataset.get_class_counts()
                },
                "training_configuration": {
                    "epochs": epochs,
                    "batch_size": batch_size,
                    "learning_rate": lr,
                    "weight_decay": WEIGHT_DECAY,
                    "seed": seed,
                    "device": str(device)
                }
            }
            with open(TRAINING_METADATA_JSON, "w", encoding="utf-8") as f:
                json.dump(metadata, f, indent=2)
            if metadata_out_path != TRAINING_METADATA_JSON:
                with open(metadata_out_path, "w", encoding="utf-8") as f:
                    json.dump(metadata, f, indent=2)
            logger.info(f"Saved best model checkpoint (Val Macro-F1: {best_val_f1:.4f}) to {BEST_MODEL_PT}")
        else:
            patience_counter += 1
            if patience_counter >= patience:
                logger.info(f"Early stopping triggered at epoch {epoch} (no improvement for {patience} epochs).")
                break

    # Save training history
    os.makedirs(os.path.dirname(history_out_path), exist_ok=True)
    with open(history_out_path, "w", encoding="utf-8") as f:
        json.dump(history, f, indent=2)

    total_training_time = round(time.time() - start_time, 2)
    logger.info(f"Training completed in {total_training_time}s. Best epoch: {best_epoch} with Val Macro-F1: {best_val_f1:.4f}")

    # ==================================================
    # PHASE 7: UNTOUCHED TEST SET EVALUATION
    # ==================================================
    logger.info("Evaluating best model on untouched TEST set...")
    test_dataset = MultispectralSatelliteDataset(
        manifest_path=test_manifest,
        is_train=False,
        normalization_stats=norm_stats
    )
    best_model = get_model(architecture="resnet18", pretrained=False).to(device)
    best_model.load_state_dict(torch.load(BEST_MODEL_PT, map_location=device, weights_only=True))
    test_metrics = evaluate_model_on_dataset(best_model, test_dataset, batch_size=batch_size, device=device)
    save_evaluation_reports(test_metrics)

    print("\n" + "="*50)
    print("TEST SET EVALUATION RESULTS")
    print("---------------------------")
    print(f"Test Accuracy:    {test_metrics['accuracy']*100:.2f}%")
    print(f"Macro Precision:  {test_metrics['macro_precision']:.4f}")
    print(f"Macro Recall:     {test_metrics['macro_recall']:.4f}")
    print(f"Macro F1 Score:   {test_metrics['macro_f1']:.4f}")
    print("\nPer-Class Breakdown:")
    for cls_name, metrics in test_metrics["per_class"].items():
        print(f"  {cls_name:18s} -> Precision: {metrics['precision']:.4f} | Recall: {metrics['recall']:.4f} | F1: {metrics['f1_score']:.4f} | Support: {metrics['support']}")
    print(f"\nConfusion Matrix (labels={CLASS_NAMES}):")
    for row in test_metrics["confusion_matrix"]:
        print(f"  {row}")
    print("="*50 + "\n")

    # ==================================================
    # PHASE 8: MODEL INFERENCE TEST (INDEPENDENT LOADING)
    # ==================================================
    print("\n" + "="*50)
    print("PHASE 8: INDEPENDENT MODEL INFERENCE TEST")
    print("-----------------------------------------")
    eval_model = get_model(architecture="resnet18", pretrained=False).to(device)
    eval_model.load_state_dict(torch.load(BEST_MODEL_PT, map_location=device, weights_only=True))
    eval_model.eval()

    sample_indices = [0, min(10, len(test_dataset)-1), min(25, len(test_dataset)-1), min(50, len(test_dataset)-1), min(80, len(test_dataset)-1)]
    for s_idx in sample_indices:
        t_tensor, true_label_id, s_id = test_dataset[s_idx]
        input_tensor = t_tensor.unsqueeze(0).to(device) # [1, 6, 128, 128]
        with torch.no_grad():
            logits = eval_model(input_tensor)
            probs = torch.softmax(logits, dim=1).cpu().numpy()[0]
            pred_id = int(np.argmax(probs))
            conf = float(probs[pred_id]) * 100.0

        true_cls = CLASS_NAMES[true_label_id]
        pred_cls = CLASS_NAMES[pred_id]
        prob_str = " | ".join([f"{CLASS_NAMES[i]}: {probs[i]*100:.1f}%" for i in range(len(CLASS_NAMES))])

        print(f"Sample: {s_id}")
        print(f"  Input shape: {list(input_tensor.shape[1:])}")
        print(f"  Probabilities: [{prob_str}]")
        print(f"  Prediction: {pred_cls} (True: {true_cls}) | Confidence: {conf:.1f}%\n")
    print("="*50 + "\n")

    return {
        "best_epoch": best_epoch,
        "best_val_f1": best_val_f1,
        "test_metrics": test_metrics,
        "training_time_seconds": total_training_time,
        "checkpoint_path": BEST_MODEL_PT
    }


def main():
    parser = argparse.ArgumentParser(description="Train 6-band Sentinel-2 ResNet-18 Classifier")
    parser.add_argument("--epochs", type=int, default=30, help="Number of training epochs")
    parser.add_argument("--batch-size", type=int, default=16, help="Batch size")
    parser.add_argument("--lr", type=float, default=1e-4, help="Learning rate")
    parser.add_argument("--patience", type=int, default=8, help="Early stopping patience")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    parser.add_argument("--resume", action="store_true", help="Resume training from existing best_model.pt checkpoint")
    parser.add_argument("--smoke", action="store_true", help="Run 2-epoch smoke test")
    args = parser.parse_args()

    if args.smoke:
        logger.info("Executing smoke training run (2 epochs)...")
        train_classifier(epochs=2, batch_size=min(args.batch_size, 8), resume=args.resume)
    else:
        train_classifier(epochs=args.epochs, batch_size=args.batch_size, lr=args.lr, patience=args.patience, seed=args.seed, resume=args.resume)


if __name__ == "__main__":
    main()
