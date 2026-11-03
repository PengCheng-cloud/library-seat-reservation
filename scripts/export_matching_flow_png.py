from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch


EXPERIMENT_DIR = (
    "\u9700\u6c42\u5ea7\u4f4d\u5339\u914d\u63a8\u8350\u5b9e\u9a8c_20260514"
)
FIGURE_NAME = (
    "12_\u9700\u6c42\u5ea7\u4f4d\u5339\u914d\u63a8\u8350\u6d41\u7a0b\u7ed3\u6784\u56fe.png"
)
DESKTOP_NAME = "\u9700\u6c42\u5ea7\u4f4d\u5339\u914d\u63a8\u8350\u6d41\u7a0b\u7ed3\u6784\u56fe.png"


def add_box(ax, xy, width, height, title, subtitle="", fc="#ffffff", ec="#222222"):
    box = FancyBboxPatch(
        xy,
        width,
        height,
        boxstyle="round,pad=0.012,rounding_size=0.025",
        linewidth=1.3,
        facecolor=fc,
        edgecolor=ec,
    )
    ax.add_patch(box)
    x, y = xy
    ax.text(
        x + width / 2,
        y + height * 0.62,
        title,
        ha="center",
        va="center",
        fontsize=12,
        fontweight="bold",
        color="#111111",
    )
    if subtitle:
        ax.text(
            x + width / 2,
            y + height * 0.30,
            subtitle,
            ha="center",
            va="center",
            fontsize=9.5,
            color="#333333",
            linespacing=1.25,
        )
    return box


def add_arrow(ax, start, end, text=None, rad=0.0):
    arrow = FancyArrowPatch(
        start,
        end,
        arrowstyle="-|>",
        mutation_scale=12,
        linewidth=1.1,
        color="#222222",
        connectionstyle=f"arc3,rad={rad}",
    )
    ax.add_patch(arrow)
    if text:
        tx = (start[0] + end[0]) / 2
        ty = (start[1] + end[1]) / 2
        ax.text(tx, ty + 0.035, text, ha="center", va="bottom", fontsize=8.8)


def main():
    repo_root = Path(__file__).resolve().parents[1]
    out_dir = repo_root / "docs" / EXPERIMENT_DIR / "\u56fe\u793a\u8f93\u51fa"
    out_dir.mkdir(parents=True, exist_ok=True)

    desktop = Path.home() / "Desktop"
    desktop.mkdir(parents=True, exist_ok=True)

    plt.rcParams["font.sans-serif"] = [
        "Microsoft YaHei",
        "SimHei",
        "Noto Sans CJK SC",
        "Arial Unicode MS",
        "DejaVu Sans",
    ]
    plt.rcParams["axes.unicode_minus"] = False

    fig, ax = plt.subplots(figsize=(15.6, 8.4), dpi=180)
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")

    ax.text(
        0.5,
        0.955,
        "\u9700\u6c42-\u5ea7\u4f4d\u5339\u914d\u63a8\u8350\u6d41\u7a0b\u7ed3\u6784\u56fe",
        ha="center",
        va="center",
        fontsize=18,
        fontweight="bold",
    )
    ax.text(
        0.5,
        0.918,
        "Training and Online Recommendation Pipeline",
        ha="center",
        va="center",
        fontsize=10.5,
        color="#444444",
    )

    ax.text(0.045, 0.815, "\u79bb\u7ebf\u6784\u5efa\u4e0e\u8bad\u7ec3", fontsize=12.5, fontweight="bold")
    ax.text(0.045, 0.455, "\u5728\u7ebf\u63a8\u8350\u4e0e\u9884\u7ea6\u627f\u63a5", fontsize=12.5, fontweight="bold")

    top_y = 0.69
    bot_y = 0.31
    w = 0.145
    h = 0.115
    xs = [0.055, 0.225, 0.395, 0.565, 0.735]

    add_box(
        ax,
        (xs[0], top_y),
        w,
        h,
        "\u5ea7\u4f4d\u4e3b\u6570\u636e",
        "seat_master.json\n\u5206\u533a/\u684c\u7ec4/\u73af\u5883\u6807\u7b7e",
    )
    add_box(
        ax,
        (xs[1], top_y),
        w,
        h,
        "\u9700\u6c42\u6837\u672c\u96c6",
        "56 \u7c7b\u5178\u578b\u81ea\u7136\u8bed\u8a00\u9700\u6c42\n\u89e3\u6790\u4e3a\u504f\u597d\u5411\u91cf",
    )
    add_box(
        ax,
        (xs[2], top_y),
        w,
        h,
        "\u5339\u914d\u6837\u672c\u6784\u9020",
        "\u4e00\u6761\u9700\u6c42 + \u4e00\u4e2a\u5019\u9009\u5ea7\u4f4d\n\u751f\u6210 68 \u7ef4\u7279\u5f81",
    )
    add_box(
        ax,
        (xs[3], top_y),
        w,
        h,
        "\u591a\u6a21\u578b\u5bf9\u6bd4",
        "\u903b\u8f91\u56de\u5f52/SVM/MLP/KNN\n\u8f93\u51fa Macro-F1\u3001Micro-F1\u3001Top-K",
    )
    add_box(
        ax,
        (xs[4], top_y),
        w,
        h,
        "SVM \u90e8\u7f72\u6a21\u578b",
        "svm_matching_model.joblib\n\u9762\u5411\u5b9e\u65f6\u6279\u91cf\u9884\u6d4b",
    )

    add_box(
        ax,
        (xs[0], bot_y),
        w,
        h,
        "\u7528\u6237\u9700\u6c42\u8f93\u5165",
        "\u5982\uff1a\u5b89\u9759\u3001\u9760\u7a97\u3001\u80fd\u5145\u7535\n\u9009\u62e9\u65e5\u671f\u4e0e\u65f6\u95f4\u7a97",
    )
    add_box(
        ax,
        (xs[1], bot_y),
        w,
        h,
        "\u5173\u952e\u8bcd\u89e3\u6790",
        "\u63d2\u5ea7/\u9760\u7a97/\u5b89\u9759/\u591a\u4eba\u684c\n\u5f62\u6210\u9700\u6c42\u5411\u91cf",
    )
    add_box(
        ax,
        (xs[2], bot_y),
        w,
        h,
        "\u5019\u9009\u5ea7\u4f4d\u96c6",
        "\u5148\u6309\u65f6\u95f4\u7a97\u3001\u5360\u7528\u3001\u5206\u533a\n\u6392\u9664\u4e0d\u53ef\u9884\u7ea6\u5ea7\u4f4d",
    )
    add_box(
        ax,
        (xs[3], bot_y),
        w,
        h,
        "SVM \u591a\u6807\u7b7e\u9884\u6d4b",
        "\u5c06\u540c\u4e00\u9700\u6c42\u4e0e\u6bcf\u4e2a\u5019\u9009\u5ea7\u4f4d\u7ec4\u5408\n\u8f93\u51fa\u56db\u7c7b\u5339\u914d\u6807\u7b7e\u6982\u7387",
    )
    add_box(
        ax,
        (xs[4], bot_y),
        w,
        h,
        "Top-N \u53ef\u89e3\u91ca\u6392\u5e8f",
        "\u6807\u7b7e\u6982\u7387\u805a\u5408 + \u504f\u597d\u547d\u4e2d\n+ \u51b2\u7a81\u60e9\u7f5a + \u4e1a\u52a1\u89c4\u5219",
    )

    final_box = add_box(
        ax,
        (0.405, 0.105),
        0.22,
        0.095,
        "\u5c0f\u7a0b\u5e8f\u63a8\u8350\u7ed3\u679c",
        "\u5c55\u793a\u5339\u914d\u5ea6\u3001\u591a\u6807\u7b7e\u8bc1\u636e\u3001\u63a8\u8350\u7406\u7531\n\u5e76\u8fdb\u5165\u9884\u7ea6\u786e\u8ba4\u9875",
    )

    for i in range(4):
        add_arrow(ax, (xs[i] + w, top_y + h / 2), (xs[i + 1], top_y + h / 2))
        add_arrow(ax, (xs[i] + w, bot_y + h / 2), (xs[i + 1], bot_y + h / 2))

    add_arrow(
        ax,
        (xs[4] + w / 2, top_y),
        (xs[3] + w / 2, bot_y + h),
        "\u6a21\u578b\u52a0\u8f7d",
        rad=-0.18,
    )
    add_arrow(
        ax,
        (xs[0] + w / 2, top_y),
        (xs[2] + w / 2, bot_y + h),
        "\u5ea7\u4f4d\u7279\u5f81\u590d\u7528",
        rad=0.12,
    )
    add_arrow(
        ax,
        (xs[4] + w / 2, bot_y),
        (0.515, 0.2),
        "\u8f93\u51fa\u7ed3\u679c",
        rad=-0.10,
    )

    ax.text(
        0.77,
        0.165,
        "\u6838\u5fc3\u53e3\u5f84\uff1a\u6a21\u578b\u4e0d\u662f\u76f4\u63a5\u9884\u6d4b\u201c\u67d0\u5ea7\u4f4d\u5c5e\u4e8e\u54ea\u4e00\u7c7b\u201d\uff0c\n"
        "\u800c\u662f\u9884\u6d4b\u201c\u5f53\u524d\u9700\u6c42\u4e0e\u8be5\u5019\u9009\u5ea7\u4f4d\u5728\u56db\u7c7b\u573a\u666f\u4e0a\u7684\u5339\u914d\u7a0b\u5ea6\u201d\u3002",
        ha="center",
        va="center",
        fontsize=10.5,
        bbox=dict(boxstyle="round,pad=0.4", fc="#f7f7f7", ec="#444444", lw=1.0),
    )

    for target in [out_dir / FIGURE_NAME, desktop / DESKTOP_NAME]:
        fig.savefig(target, bbox_inches="tight", pad_inches=0.16)
        print(target)

    plt.close(fig)


if __name__ == "__main__":
    main()
