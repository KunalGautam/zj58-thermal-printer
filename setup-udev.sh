#!/bin/bash

# ZJ-58 USB printer Vendor ID and Product ID
VID="0416"
PID="5011"

RULE_PATH="/etc/udev/rules.d/99-thermal-printer.rules"

echo "=== ZJ-58 USB Printer Permission Setup ==="
echo "This script will create a udev rule to allow non-root users access to your printer."
echo "Target rule file: $RULE_PATH"
echo ""

# Write udev rule
echo "Writing udev rule for USB device $VID:$PID..."
echo "SUBSYSTEM==\"usb\", ATTR{idVendor}==\"$VID\", ATTR{idProduct}==\"$PID\", MODE=\"0666\"" | sudo tee $RULE_PATH > /dev/null

if [ $? -ne 0 ]; then
    echo "Error: Failed to write udev rules. Please run this script or run the write command with sudo."
    exit 1
fi

# Reload udev rules
echo "Reloading udev rules..."
sudo udevadm control --reload-rules
sudo udevadm trigger

echo ""
echo "=== Success ==="
echo "Permissions have been successfully updated. Please unplug the printer's USB cable, plug it back in, and restart your server."
