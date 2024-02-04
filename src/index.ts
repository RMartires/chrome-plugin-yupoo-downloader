import {
  ACTION_KEYS,
  DONWLOAD_STATUS_ID,
  DOWNLOAD_BTN_DISABLED_CLASS,
} from "./constants";

const DOWNLOAD_BTN_ID = "donwload-btn";

function main() {
  const downloadBtn = document.getElementById(DOWNLOAD_BTN_ID);
  if (downloadBtn) {
    downloadBtn.onclick = onClick;
  }

  setInterval(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });

    if (tab && tab.id) {
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: ACTION_KEYS.GET_PROGRESS,
      });

      const downloadStatus = document.getElementById(DONWLOAD_STATUS_ID);
      if (downloadStatus) {
        downloadStatus.innerText = response.msg;
      }
    }
  }, 1000 * 5);
}

async function onClick() {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  if (tab && tab.id) {
    const downloadBtn = document.getElementById(DOWNLOAD_BTN_ID);
    if (downloadBtn) {
      downloadBtn.className += " " + DOWNLOAD_BTN_DISABLED_CLASS;
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      action: ACTION_KEYS.DOWNLOAD_ALBUM,
    });

    if (downloadBtn) {
      downloadBtn.className.replace(DOWNLOAD_BTN_DISABLED_CLASS, "");
    }

    // do something with response here, not outside the function
    console.log(response);
  }
}

main();
