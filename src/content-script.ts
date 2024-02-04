import axios from "axios";
import JSZip from "jszip";
import { load } from "cheerio";
import streamsaver from "streamsaver";
import {
  ACTION_KEYS,
  ALBUM_PAGE_URL,
  BIG_IMAGE_PAGE_VIEW_QUERY_PARAM,
  CORS_ANYWHERE_PROXY,
  DEFAULT_PAGE_CNT,
  DOWNLOAD_BTN_DISABLED_CLASS,
  DOWNLOAD_BTN_ID,
  HTTPS_PREFIX,
  YUPOO_ALBUM_CLASS,
  YUPOO_ALBUM_IMAGE_CLASS,
  YUPOO_ALBUM_IMAGE_NAME_CLASS,
  YUPOO_PAGINATION_CLASS_NAME,
} from "./constants";
import { chunks } from "./utills";

let downloadInProgress = false;
let statusMessage = "";

function mainContentScript() {
  chrome.runtime.onMessage.addListener(async function (
    request,
    sender,
    sendResponse
  ) {
    // console.log("from the extension", request.action);
    if (request.action === ACTION_KEYS.DOWNLOAD_ALBUM) {
      if (downloadInProgress) {
        return sendResponse({ inProgress: downloadInProgress });
      }

      downloadInProgress = true;

      await initScrape();

      downloadInProgress = false;

      sendResponse({ inProgress: downloadInProgress });
    } else if (request.action === ACTION_KEYS.GET_PROGRESS) {
      return sendResponse({ msg: statusMessage });
    }
  });
}

mainContentScript();

interface IYupooPageData {
  title: string;
  link: string;
  images?: IYupooImageData[];
}

interface IYupooImageData {
  title: string;
  link: string;
}

const HOST_NAME = window.location.hostname;

async function scrapePageMeta(pageNum: number) {
  console.log("init album download");
  const pageData: IYupooPageData[] = [];

  const url = HTTPS_PREFIX + HOST_NAME + ALBUM_PAGE_URL + `&page=${pageNum}`;
  console.log("scraping from", url);

  const resp = await axios.get(url);
  const $ = load(resp.data);
  const $albumItems = $(YUPOO_ALBUM_CLASS);

  for (let i = 0; i < $albumItems.length; i++) {
    pageData.push({
      title: $albumItems[i].attribs.title,
      link: $albumItems[i].attribs.href,
    });
  }

  console.log("got page grid data, init scraping all albums");
  const albumPageData: IYupooPageData[] = [];

  let progress = 0;
  const batches = chunks(pageData, 1);
  for (const batch of batches) {
    const resp = await Promise.all(
      batch.map((batch) => {
        return scrapeAlbum(batch, HOST_NAME);
      })
    );

    albumPageData.push(...resp);
    progress += batch.length;

    let percentage = (progress / pageData.length) * 100;
    percentage = Math.round(percentage);

    const msg = `scraping meta-data from page ${pageNum}, progress: ${percentage}%`;
    statusMessage = msg;
  }

  return albumPageData;
}

async function scrapeAlbum(data: IYupooPageData, hostname: string) {
  // e.g. https://goat-official.x.yupoo.com/albums/154157810?uid=1&tab=max

  const imageData: IYupooImageData[] = [];

  const url =
    HTTPS_PREFIX + hostname + data.link + BIG_IMAGE_PAGE_VIEW_QUERY_PARAM;

  const resp = await axios.get(url);
  const $ = load(resp.data);
  const $albumImageItems = $(YUPOO_ALBUM_IMAGE_CLASS);
  const $albumImageNameItems = $(YUPOO_ALBUM_IMAGE_NAME_CLASS);

  for (let i = 0; i < $albumImageItems.length; i++) {
    const rawImageLink = $albumImageItems[i].attribs["data-src"];

    imageData.push({
      title: $albumImageNameItems[i].attribs.title,
      link: rawImageLink.split("//")[1] ?? "",
    });
  }

  // console.log(imageData);

  data.images = imageData;

  return data;
}

async function getNumberOfPages(): Promise<number> {
  const url = HTTPS_PREFIX + HOST_NAME + ALBUM_PAGE_URL;

  const resp = await axios.get(url);
  const $ = load(resp.data);
  const $paginationItems = $(YUPOO_PAGINATION_CLASS_NAME);

  if ($paginationItems.length == 0) {
    return DEFAULT_PAGE_CNT;
  }
  const childern = $paginationItems[0].children;

  if (childern.length == 0) {
    return DEFAULT_PAGE_CNT;
  }
  const firstNode = childern[0] as { data: string };
  const text = firstNode["data"];
  const numberText = text.split("total")[1].split("pages")[0];

  return Number(numberText);
}

async function downloadImage(url: string, referer: string): Promise<Blob> {
  const resp = await fetch(url, {
    headers: {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.9",
      "sec-ch-ua":
        '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Linux"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "no-cors",
      "sec-fetch-site": "cross-site",
    },
    referrer: referer,
    referrerPolicy: "no-referrer-when-downgrade",
    body: null,
    method: "GET",
    mode: "cors",
    credentials: "omit",
  });

  const blob = await resp.blob();
  return blob;
}

async function initScrape() {
  const numberOfPages = 1; //await getNumberOfPages();
  const pages: IYupooPageData[][] = [];
  for (let i = 1; i <= numberOfPages; i++) {
    const pageData = await scrapePageMeta(i);
    pages.push(pageData);
  }

  const zip = new JSZip();
  let pageNum = 1;
  for (const pageMetaData of pages) {
    console.log("downloading media for page: ");
    let albumNum = 1;
    for (const albumMeta of pageMetaData) {
      const referer =
        HTTPS_PREFIX +
        HOST_NAME +
        albumMeta.link +
        BIG_IMAGE_PAGE_VIEW_QUERY_PARAM;
      if (albumMeta.images && albumMeta.images.length > 0) {
        const albumFolder = zip.folder(albumMeta.title);
        console.log("downloading album: " + albumMeta.title);
        if (albumFolder) {
          for (const imageMeta of albumMeta.images) {
            const url = CORS_ANYWHERE_PROXY + HTTPS_PREFIX + imageMeta.link;
            const imageBlob = await downloadImage(url, referer);
            albumFolder.file(imageMeta.title, imageBlob);
          }

          // update status
          let percentage = (albumNum / pageMetaData.length) * 100;
          percentage = Math.round(percentage);

          if (percentage > 100) {
            percentage = 100;
          }

          statusMessage = `downloading page ${pageNum}, progress: ${percentage}%`;
        }
      }

      albumNum += 1;
    }

    pageNum += 1;
  }

  const fileStream = streamsaver.createWriteStream(HOST_NAME + ".zip");
  const writer = fileStream.getWriter();

  zip
    .generateInternalStream({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: {
        level: 8,
      },
      streamFiles: true,
    })
    .on("data", (data, metadata) => writer.write(data))
    .on("end", () => writer.close())
    .resume();

  statusMessage += "download complete!";
  // .then((file) => {
  //   saveAs(file, HOST_NAME + ".zip");
  // })
  // .catch((err) => {
  //   console.log("Failed while saving zip file, due to ::", err);
  // });
}
