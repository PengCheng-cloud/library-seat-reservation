Component({
  data: {
    selected: "pages/home/index",
    tabs: [
      {
        key: "home",
        route: "pages/home/index",
        url: "/pages/home/index",
        label: "首页",
        iconText: "首"
      },
      {
        key: "seat",
        route: "pages/seat/index",
        url: "/pages/seat/index",
        label: "选座",
        iconText: "座"
      },
      {
        key: "reservation",
        route: "pages/reservation/index",
        url: "/pages/reservation/index",
        label: "预约",
        iconText: "约"
      },
      {
        key: "profile",
        route: "pages/profile/index",
        url: "/pages/profile/index",
        label: "我的",
        iconText: "我"
      }
    ]
  },

  lifetimes: {
    attached() {
      this.syncSelected();
    }
  },

  pageLifetimes: {
    show() {
      this.syncSelected();
    }
  },

  methods: {
    syncSelected() {
      const pages = getCurrentPages();
      const currentPage = pages[pages.length - 1];
      const selected = currentPage ? currentPage.route : "pages/home/index";

      if (selected !== this.data.selected) {
        this.setData({
          selected
        });
      }
    },

    handleTabTap(event) {
      const { route, url } = event.currentTarget.dataset;
      if (!route || !url) {
        return;
      }

      if (typeof wx.vibrateShort === "function") {
        wx.vibrateShort({
          type: "light"
        });
      }

      if (route === this.data.selected) {
        if (typeof wx.pageScrollTo === "function") {
          wx.pageScrollTo({
            scrollTop: 0,
            duration: 220
          });
        }
        return;
      }

      wx.switchTab({
        url
      });
    }
  }
});
