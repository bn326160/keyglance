#!/usr/bin/env python3
"""Generate KeyGlance app icons at all required sizes."""

from PIL import Image, ImageDraw
import struct
import io
import os

ICON_DIR = os.path.join(os.path.dirname(__file__), "src-tauri", "icons")


def draw_rounded_rect(draw, bbox, radius, fill):
    """Draw a rounded rectangle."""
    x0, y0, x1, y1 = bbox
    # Clamp radius to half the smallest dimension
    radius = min(radius, (x1 - x0) // 2, (y1 - y0) // 2)
    if radius < 0:
        radius = 0
    draw.rectangle([x0 + radius, y0, x1 - radius, y1], fill=fill)
    draw.rectangle([x0, y0 + radius, x1, y1 - radius], fill=fill)
    draw.pieslice([x0, y0, x0 + 2 * radius, y0 + 2 * radius], 180, 270, fill=fill)
    draw.pieslice([x1 - 2 * radius, y0, x1, y0 + 2 * radius], 270, 360, fill=fill)
    draw.pieslice([x0, y1 - 2 * radius, x0 + 2 * radius, y1], 90, 180, fill=fill)
    draw.pieslice([x1 - 2 * radius, y1 - 2 * radius, x1, y1], 0, 90, fill=fill)


def draw_icon(size):
    """Generate a KeyGlance icon: simple keyboard with colored keys."""
    ss = 4
    s = size * ss
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded square background
    bg_margin = int(s * 0.04)
    bg_r = int(s * 0.22)
    draw_rounded_rect(draw, [bg_margin, bg_margin, s - bg_margin, s - bg_margin], bg_r, (210, 212, 218, 255))

    # --- Keyboard body: wide rounded rectangle, centered ---
    kb_x0 = int(s * 0.10)
    kb_y0 = int(s * 0.28)
    kb_x1 = s - int(s * 0.10)
    kb_y1 = int(s * 0.72)
    kb_r = int(s * 0.06)
    draw_rounded_rect(draw, [kb_x0, kb_y0, kb_x1, kb_y1], kb_r, (42, 42, 50, 255))

    # --- 3 rows of colored keys inside the keyboard ---
    finger_colors = {
        "lp": (244, 163, 184),   # pink
        "lr": (253, 186, 116),   # orange
        "lm": (253, 224, 71),    # yellow
        "li": (134, 239, 172),   # green
        "ri": (94, 234, 212),    # teal
        "rm": (147, 197, 253),   # blue
        "rr": (165, 180, 252),   # indigo
        "rp": (216, 180, 254),   # purple
    }

    rows = [
        ["lp","lr","lm","li","li", None, "ri","ri","rm","rr","rp"],
        ["lp","lr","lm","li","li", None, "ri","ri","rm","rr","rp"],
        ["lp","lr","lm","li","li", None, "ri","ri","rm","rr","rp"],
    ]

    pad_x = int(s * 0.04)
    pad_y = int(s * 0.035)
    area_x0 = kb_x0 + pad_x
    area_y0 = kb_y0 + pad_y
    area_w = (kb_x1 - kb_x0) - 2 * pad_x
    area_h = (kb_y1 - kb_y0) - 2 * pad_y

    cols = 11
    nrows = 3
    csp = area_w / cols
    rsp = area_h / nrows
    kw = int(csp * 0.78)
    kh = int(rsp * 0.72)
    kr = max(int(min(kw, kh) * 0.30), 1)

    for ri, row in enumerate(rows):
        for ci, f in enumerate(row):
            if f is None:
                continue
            cx = area_x0 + int(csp * (ci + 0.5))
            cy = area_y0 + int(rsp * (ri + 0.5))
            color = finger_colors[f]
            alpha = 245 if ri == 1 else 180
            draw_rounded_rect(draw,
                [cx - kw//2, cy - kh//2, cx + kw//2, cy + kh//2],
                kr, (*color, alpha))

    # Downsample
    img = img.resize((size, size), Image.LANCZOS)
    return img


def create_icns(img_1024, output_path):
    """Create a .icns file from a source image."""
    # macOS icns uses specific sizes
    sizes_and_types = [
        (16, b"icp4"),
        (32, b"icp5"),
        (64, b"icp6"),
        (128, b"ic07"),
        (256, b"ic08"),
        (512, b"ic09"),
        (1024, b"ic10"),
    ]

    entries = []
    for sz, ostype in sizes_and_types:
        resized = img_1024.resize((sz, sz), Image.LANCZOS)
        buf = io.BytesIO()
        resized.save(buf, format="PNG")
        png_data = buf.getvalue()
        # Entry: type (4 bytes) + length (4 bytes) + data
        entry_len = 8 + len(png_data)
        entry = ostype + struct.pack(">I", entry_len) + png_data
        entries.append(entry)

    body = b"".join(entries)
    header = b"icns" + struct.pack(">I", 8 + len(body))

    with open(output_path, "wb") as f:
        f.write(header + body)


def create_ico(img_src, output_path):
    """Create a .ico file with multiple sizes."""
    sizes = [16, 24, 32, 48, 64, 128, 256]
    imgs = []
    for sz in sizes:
        imgs.append(img_src.resize((sz, sz), Image.LANCZOS))
    # Save with explicit sizes
    imgs[-1].save(
        output_path,
        format="ICO",
        sizes=[(img.width, img.height) for img in imgs],
        append_images=imgs[:-1],
    )


def main():
    os.makedirs(ICON_DIR, exist_ok=True)

    # Generate the master icon at high resolution
    master = draw_icon(1024)

    # Save icon.png (master)
    master.save(os.path.join(ICON_DIR, "icon.png"))
    print("Generated icon.png (1024x1024)")

    # Generate required PNG sizes for Tauri
    png_sizes = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
    }

    for name, sz in png_sizes.items():
        resized = master.resize((sz, sz), Image.LANCZOS)
        resized.save(os.path.join(ICON_DIR, name))
        print(f"Generated {name} ({sz}x{sz})")

    # Windows Store logos
    store_sizes = {
        "Square30x30Logo.png": 30,
        "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
        "StoreLogo.png": 50,
    }

    for name, sz in store_sizes.items():
        resized = master.resize((sz, sz), Image.LANCZOS)
        resized.save(os.path.join(ICON_DIR, name))
        print(f"Generated {name} ({sz}x{sz})")

    # Generate .icns for macOS
    create_icns(master, os.path.join(ICON_DIR, "icon.icns"))
    print("Generated icon.icns")

    # Generate .ico for Windows
    create_ico(master, os.path.join(ICON_DIR, "icon.ico"))
    print("Generated icon.ico")

    # Generate tray icon (template-style, simpler)
    tray = draw_icon(64)
    tray.save(os.path.join(ICON_DIR, "tray-icon.png"))
    print("Generated tray-icon.png (64x64)")

    print("\nAll icons generated successfully!")


if __name__ == "__main__":
    main()
