import torch
import torch.nn as nn
from typing import Dict, Any

from app.ml.satellite_model.config import NUM_CHANNELS, NUM_CLASSES


class MultispectralCNN(nn.Module):
    """
    6-Band Sentinel-2 Multispectral Convolutional Neural Network Baseline.
    Processes [B, 6, H, W] tensor input (B02, B03, B04, B08, B11, B12) and outputs
    classification logits for [WILDFIRE, INDUSTRIAL_FIRE, NON_FIRE].
    """

    def __init__(self, in_channels: int = NUM_CHANNELS, num_classes: int = NUM_CLASSES, dropout_rate: float = 0.3):
        super(MultispectralCNN, self).__init__()
        
        self.in_channels = in_channels
        self.num_classes = num_classes

        # Feature Extractor Blocks
        self.block1 = nn.Sequential(
            nn.Conv2d(in_channels, 32, kernel_size=3, stride=1, padding=1, bias=False),
            nn.BatchNorm2d(32),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(kernel_size=2, stride=2)  # 128 -> 64
        )

        self.block2 = nn.Sequential(
            nn.Conv2d(32, 64, kernel_size=3, stride=1, padding=1, bias=False),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(kernel_size=2, stride=2)  # 64 -> 32
        )

        self.block3 = nn.Sequential(
            nn.Conv2d(64, 128, kernel_size=3, stride=1, padding=1, bias=False),
            nn.BatchNorm2d(128),
            nn.ReLU(inplace=True)
        )

        # Classification Head
        self.pool = nn.AdaptiveAvgPool2d((1, 1))
        self.dropout = nn.Dropout(p=dropout_rate)
        self.classifier = nn.Linear(128, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Forward pass.
        Input x: [B, 6, H, W]
        Returns logits: [B, num_classes]
        """
        x = self.block1(x)
        x = self.block2(x)
        x = self.block3(x)
        x = self.pool(x)
        x = torch.flatten(x, 1)
        x = self.dropout(x)
        logits = self.classifier(x)
        return logits


import torchvision.models as models

class MultispectralResNet18(nn.Module):
    """
    6-Band Sentinel-2 Adapted ResNet-18 Architecture for Multispectral Fire Intelligence.
    Adapts ResNet-18 for 6-channel multispectral input:
    Channel Order: [B02, B03, B04, B08, B11, B12]
    Output: Exactly 3 logits: [NON_FIRE, WILDFIRE, INDUSTRIAL_FIRE]

    Weight Initialization Strategy:
    - B02 (Blue), B03 (Green), B04 (Red) receive ImageNet-pretrained weights from corresponding RGB channels:
      * Channel 0 (B02): Initialized from ImageNet Blue filter (channel 2)
      * Channel 1 (B03): Initialized from ImageNet Green filter (channel 1)
      * Channel 2 (B04): Initialized from ImageNet Red filter (channel 0)
    - Non-visible bands (NIR B08, SWIR-1 B11, SWIR-2 B12):
      * Channel 3 (B08), Channel 4 (B11), Channel 5 (B12) are initialized using the mean RGB filter bank,
        providing stable initial feature gradients without random noise.
    - Final linear projection layer adapted for 3 target classes.
    """

    def __init__(self, in_channels: int = NUM_CHANNELS, num_classes: int = NUM_CLASSES, pretrained: bool = True):
        super(MultispectralResNet18, self).__init__()
        self.in_channels = in_channels
        self.num_classes = num_classes

        # Load standard ResNet-18 backbone
        weights = models.ResNet18_Weights.DEFAULT if pretrained else None
        base = models.resnet18(weights=weights)

        # 6-channel adapted first convolution
        old_conv = base.conv1
        new_conv = nn.Conv2d(
            in_channels,
            old_conv.out_channels,
            kernel_size=old_conv.kernel_size,
            stride=old_conv.stride,
            padding=old_conv.padding,
            bias=False
        )

        with torch.no_grad():
            if pretrained:
                new_conv.weight[:, 0, :, :] = old_conv.weight[:, 2, :, :]  # B02 from Blue
                new_conv.weight[:, 1, :, :] = old_conv.weight[:, 1, :, :]  # B03 from Green
                new_conv.weight[:, 2, :, :] = old_conv.weight[:, 0, :, :]  # B04 from Red
                mean_rgb = old_conv.weight.mean(dim=1)
                new_conv.weight[:, 3, :, :] = mean_rgb                     # B08 NIR
                new_conv.weight[:, 4, :, :] = mean_rgb                     # B11 SWIR-1
                new_conv.weight[:, 5, :, :] = mean_rgb                     # B12 SWIR-2
            else:
                nn.init.kaiming_normal_(new_conv.weight, mode='fan_out', nonlinearity='relu')

        base.conv1 = new_conv
        base.fc = nn.Linear(base.fc.in_features, num_classes)
        self.backbone = base

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Input x: [B, 6, 128, 128] float32
        Returns logits: [B, 3]
        """
        return self.backbone(x)


def get_model(
    architecture: str = "resnet18",
    in_channels: int = NUM_CHANNELS,
    num_classes: int = NUM_CLASSES,
    pretrained: bool = True
) -> nn.Module:
    """
    Model constructor helper returning 6-channel adapted architecture.
    """
    if architecture.lower() == "cnn":
        return MultispectralCNN(in_channels=in_channels, num_classes=num_classes)
    return MultispectralResNet18(in_channels=in_channels, num_classes=num_classes, pretrained=pretrained)

