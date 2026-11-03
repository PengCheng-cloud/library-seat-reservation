const { getShowcaseCollection } = require("../../config/showcase");
const { openPage } = require("../../utils/navigation");

function normalizeType(type) {
  return type === "scene" ? "scene" : "space";
}

function buildDetailUrl(type, key) {
  return `/pages/showcase-detail/index?type=${encodeURIComponent(type)}&key=${encodeURIComponent(key || "")}`;
}

Page({
  data: {
    type: "space",
    collectionTitle: "",
    collectionSubtitle: "",
    itemCount: 0,
    items: [],
    supplementalTitle: "",
    supplementalSubtitle: "",
    supplementalItems: []
  },

  onLoad(options) {
    const type = normalizeType(options && options.type);
    const collection = getShowcaseCollection(type);
    const items = (collection.items || []).map((item) => ({
      ...item,
      galleryCount: (item.gallery || []).length
    }));
    const supplementalItems = collection.supplementalItems || [];

    this.setData({
      type,
      collectionTitle: collection.title || "",
      collectionSubtitle: collection.subtitle || "",
      itemCount: items.length + supplementalItems.length,
      items,
      supplementalTitle: collection.supplementalTitle || "",
      supplementalSubtitle: collection.supplementalSubtitle || "",
      supplementalItems
    });

    wx.setNavigationBarTitle({
      title: collection.title || "空间图集"
    });
  },

  openDetail(event) {
    const { key } = event.currentTarget.dataset;
    if (!key) {
      return;
    }

    openPage(buildDetailUrl(this.data.type, key));
  }
});
