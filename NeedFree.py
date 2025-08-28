from concurrent.futures import ThreadPoolExecutor, wait, ALL_COMPLETED
import traceback
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import datetime
import os
import queue
import time
import json
import pytz
import bs4
import re
import random
import argparse


API_URL_TEMPLATE = "https://store.steampowered.com/search/results/?query&start={pos}&count=100&hidef2p=1&infinite=1&ndl=1&cc={cc}&l={lang}"
THREAD_CNT = 4

free_list = queue.Queue()

_DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://store.steampowered.com/",
    "X-Requested-With": "XMLHttpRequest",
}
_DEFAULT_COOKIES = {
    "birthtime": "0",
    "lastagecheckage": "1-January-1970",
}

def build_session(lang: str):
    session = requests.Session()
    retries = Retry(
        total=5,
        backoff_factor=0.5,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"],
    )
    adapter = HTTPAdapter(max_retries=retries)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    session.headers.update(_DEFAULT_HEADERS)
    lang_to_accept = {
        "english": "en-US,en;q=0.9",
    }
    session.headers["Accept-Language"] = lang_to_accept.get(lang, "en-US,en;q=0.9")
    cookies = dict(_DEFAULT_COOKIES)
    cookies["Steam_Language"] = lang
    session.cookies.update(cookies)
    return session

def fetch_Steam_json_response(url, session: requests.Session):
    ''' Fetch json response from Steam API
    URL:            Steam WebAPI url

    return:         json content
    '''
    max_retries = 5
    backoffs = [1, 2, 3, 5, 5]
    attempt = 0
    while attempt < max_retries:
        try:
            response = session.get(url, timeout=10)
            response.raise_for_status()
            ctype = (response.headers.get("Content-Type") or "").lower()
            if "application/json" not in ctype:
                preview = response.text[:200].replace("\n", " ")
                raise ValueError(f"Non-JSON response (Content-Type={ctype}): {preview}")

            ret_json = response.json()
            if not isinstance(ret_json, dict) or ("total_count" not in ret_json or "results_html" not in ret_json):
                raise ValueError("Unexpected response structure from Steam")
            return ret_json
        except Exception as e:
            print(f"fetch_Steam_json_response: attempt {attempt+1}/{max_retries} failed: {e}")
            sleep_sec = backoffs[attempt] if attempt < len(backoffs) else 5
            time.sleep(sleep_sec)
            attempt += 1
    raise RuntimeError("Failed to fetch Steam response after retries")

def get_free_goods(start, append_list = False, session: requests.Session = None, cc: str = "us", lang: str = "english"):
    ''' Extract discount goods list in a list of 100 products
    start:          start page index
    append_list:    if to append new found free goods to final list

    return:         goods_count
    '''

    global free_list
    retry_time = 0

    while retry_time >= 0:
        time.sleep(random.uniform(0.2, 0.6))
        print(f"[FreeSteam] Загрузка страницы start={start}")
        url = API_URL_TEMPLATE.format(pos=start, cc=cc, lang=lang)
        response_json = fetch_Steam_json_response(url, session)
        try:
            goods_count = response_json["total_count"]
            goods_html = response_json["results_html"]
            page_parser = bs4.BeautifulSoup(goods_html, "html.parser")
            full_discounts_div = page_parser.find_all(name = "div", attrs = {"class":"search_discount_block"})
            sub_free_list = [
                {
                    'id': None,
                    'popularity': start + idx,
                    'discount': div.parent.parent.parent.parent.find(name="div", attrs={"class": "search_discount_block"}).get("data-discount"),
                    'price': div.parent.parent.parent.parent.find(name="div", attrs={"class": "discount_original_price"}),
                    'price_final': div.parent.parent.parent.parent.find(name="div", attrs={"class": "discount_final_price"}).get_text(),
                    'title': div.parent.parent.parent.parent.find(name="span", attrs={"class": "title"}).get_text(),
                    'link': div.parent.parent.parent.parent.get("href"),
                    'image': div.parent.parent.parent.parent.find_all("div")[0].find("img").get("src"),
                    'tags': div.parent.parent.parent.parent.get("data-ds-tagids"),
                    'is_bundle': div.parent.parent.parent.parent.get("data-ds-bundleid"),
                    'bundle_data': div.parent.parent.parent.parent.get("data-ds-bundle-data"),
                    'is_soundtrack': div.parent.parent.parent.parent.find(name="span", attrs={"class": "music"}),
                    'for_win': div.parent.parent.parent.parent.find(name="span", attrs={"class": "win"}),
                    'for_mac': div.parent.parent.parent.parent.find(name="span", attrs={"class": "mac"}),
                    'for_linux': div.parent.parent.parent.parent.find(name="span", attrs={"class": "linux"}),
                    'vr_support': div.parent.parent.parent.parent.find(name="span", attrs={"class": "vr_supported"}),
                    'release': div.parent.parent.parent.parent.find(name="div", attrs={"class": "search_released"}),
                    'reviews': div.parent.parent.parent.parent.find(name="span", attrs={"class": "search_review_summary"})
                } for idx, div in enumerate(full_discounts_div)
            ]

            counter = 0
            if append_list:
                for sub_free in sub_free_list:
                    if not sub_free['discount']:
                        sub_free['discount'] = '0'

                    if sub_free['price']:
                        sub_free['price'] = sub_free['price'].get_text()
                    else:
                        sub_free['price'] = ''

                    if sub_free['price_final'] in ('Free', 'Бесплатно'):
                        sub_free['price_final'] = '0'

                    if not sub_free['price']:
                        sub_free['price'] = sub_free['price_final']

                    if sub_free['release']:
                        sub_free['release'] = sub_free['release'].get_text()
                    else:
                        sub_free['release'] = ''

                    if sub_free['reviews']:
                        sub_free['reviews'] = sub_free['reviews'].get("data-tooltip-html")
                    else:
                        sub_free['reviews'] = r'None<br>0% of the 0'

                    counter += 1
                    free_list.put(sub_free)

            print(f"[FreeSteam] Страница start={start} успешно, найдено элементов: {len(sub_free_list)}")
            return goods_count
        except Exception as e:
            print("get_free_goods: error on start = %d, remain retry %d time(s)" % (start, retry_time))
            print(e)
            print(traceback.format_exc())
            retry_time -= 1
    print("get_free_goods: error on start = %d, throw" % (start))

    return 0

def run_crawl(session: requests.Session, cc: str, lang: str):
    tryget_first_page = get_free_goods(0, False, session, cc, lang)
    total_count = tryget_first_page

    threads = ThreadPoolExecutor(max_workers=THREAD_CNT)
    futures = [threads.submit(get_free_goods, index, True, session, cc, lang) for index in range(0, total_count, 100)]
    wait(futures, return_when=ALL_COMPLETED)

    final_free_list = []
    free_ids = set()
    while not free_list.empty():
        free_item = free_list.get()

        game_id = re.search(r'.com\/[a-z]+\/(\d+)\/', free_item['link'])
        if game_id is None:
            continue

        game_id = int(game_id.group(1))
        if game_id in free_ids:
            continue

        free_item['id'] = game_id

        free_item['tags'] = json.loads(free_item['tags'] or '[]')
        free_item['bundle_data'] = json.loads(free_item['bundle_data'] or r'{}')

        free_item['discount'] = int(free_item['discount'])

        free_item['is_bundle'] = bool(free_item['is_bundle'])
        free_item['is_soundtrack'] = bool(free_item['is_soundtrack'])
        free_item['for_win'] = bool(free_item['for_win'])
        free_item['for_mac'] = bool(free_item['for_mac'])
        free_item['for_linux'] = bool(free_item['for_linux'])
        free_item['vr_support'] = bool(free_item['vr_support'])

        free_item['release'] = free_item['release'].strip() or ''

        score_match = re.search(r'^([a-zA-Z ]+)\<br\>(\d{1,3})% of the ([\d,]+)', free_item['reviews'])
        if score_match:
            score, percent, users = score_match.groups()
            free_item['review_score'] = score
            free_item['review_percent'] = int(percent)
            free_item['review_users'] = int(users.replace(',', ''))
        else:
            free_item['review_score'] = 'None'
            free_item['review_percent'] = 0
            free_item['review_users'] = 0

        free_ids.add(game_id)
        final_free_list.append(free_item)

    today = datetime.datetime.now(tz=pytz.timezone("Europe/Moscow"))
    final_free_list_part1 = final_free_list[:len(final_free_list)//2]
    final_free_list_part2 = final_free_list[len(final_free_list)//2:]

    base_part1 = "free_goods_detail_part1.json"
    base_part2 = "free_goods_detail_part2.json"

    with open(base_part1, "w", encoding="utf-8") as fp:
        json.dump({
            "total_count": len(final_free_list_part1),
            "free_list": final_free_list_part1,
            "update_time": today.strftime('%Y-%m-%d %H:%M:%S')
        }, fp, ensure_ascii=False)

    with open(base_part2, "w", encoding="utf-8") as fp:
        json.dump({
            "total_count": len(final_free_list_part2),
            "free_list": final_free_list_part2,
            "update_time": today.strftime('%Y-%m-%d %H:%M:%S')
        }, fp, ensure_ascii=False)


    out_dir = os.path.join("data", lang)
    os.makedirs(out_dir, exist_ok=True)

    def save_json(path, payload):
        with open(path, "w", encoding="utf-8") as fp:
            json.dump(payload, fp, ensure_ascii=False)

    payload_part1 = {"total_count": len(final_free_list_part1), "free_list": final_free_list_part1, "update_time": today.strftime('%Y-%m-%d %H:%M:%S')}
    payload_part2 = {"total_count": len(final_free_list_part2), "free_list": final_free_list_part2, "update_time": today.strftime('%Y-%m-%d %H:%M:%S')}

    save_json(os.path.join(out_dir, "free_goods_detail_part1.json"), payload_part1)
    save_json(os.path.join(out_dir, "free_goods_detail_part2.json"), payload_part2)

    return len(final_free_list)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="FreeSteam crawler")
    parser.add_argument("--cc", default="us", help="Код страны Steam для валюты (например: ru, us, de, gb, tr, kz)")
    parser.add_argument("--lang", default="english", help="Язык интерфейса Steam (например: russian, english, german, spanish, french, turkish)")
    parser.add_argument("--interval", type=int, default=3600, help="Интервал обновления в секундах (по умолчанию: 3600 = 1 час)")
    parser.add_argument("--once", action="store_true", help="Выполнить один прогон и выйти")
    args = parser.parse_args()

    session = build_session(args.lang)

    try:
        if args.once:
            total = run_crawl(session, args.cc, args.lang)
            now = datetime.datetime.now(tz=pytz.timezone("Europe/Moscow")).strftime('%Y-%m-%d %H:%M:%S')
            print(f"[{now}] FreeSteam: одноразовое обновление завершено, найдено записей: {total}")
        else:
            while True:
                try:
                    total = run_crawl(session, args.cc, args.lang)
                    now = datetime.datetime.now(tz=pytz.timezone("Europe/Moscow")).strftime('%Y-%m-%d %H:%M:%S')
                    print(f"[{now}] FreeSteam: обновление завершено, найдено записей: {total}")
                except Exception as ex:
                    print(f"FreeSteam: ошибка выполнения: {ex}")
                time.sleep(args.interval)
    except KeyboardInterrupt:
        print("FreeSteam: остановлено пользователем (KeyboardInterrupt)")

