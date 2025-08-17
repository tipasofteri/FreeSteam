import os
from typing import Optional
from bs4 import BeautifulSoup
from flask import Flask, request, jsonify, make_response
import requests
import re

app = Flask(__name__)


def corsify(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


@app.route("/api/health", methods=["GET"])  # simple healthcheck
def health():
    return corsify(make_response(jsonify({"ok": True}), 200))


 


 


# ===== OPEN (no API key) profile info via steamcommunity XML =====
def fetch_xml(url, params=None, timeout=20):
    headers = {"User-Agent": "Mozilla/5.0 (compatible; FreeSteamBot/1.0)"}
    r = requests.get(url, params=params or {}, timeout=timeout, headers=headers)
    r.raise_for_status()
    return r.text


# Порт ключевых констант из SteamID.php
_TYPE_INVALID = 0
_TYPE_INDIVIDUAL = 1
_TYPE_MULTISEAT = 2
_TYPE_GAMESERVER = 3
_TYPE_ANON_GAMESERVER = 4
_TYPE_PENDING = 5
_TYPE_CONTENT_SERVER = 6
_TYPE_CLAN = 7
_TYPE_CHAT = 8
_TYPE_P2P_SUPER_SEEDER = 9
_TYPE_ANON_USER = 10

_UNIVERSE_INVALID = 0
_UNIVERSE_PUBLIC = 1
_UNIVERSE_BETA = 2
_UNIVERSE_INTERNAL = 3
_UNIVERSE_DEV = 4

_INSTANCE_FLAG_CLAN = 524288
_INSTANCE_FLAG_LOBBY = 262144
_INSTANCE_FLAG_MMSLOBBY = 131072

_ACCOUNT_TYPE_CHARS = {
    _TYPE_ANON_GAMESERVER: 'A',
    _TYPE_GAMESERVER: 'G',
    _TYPE_MULTISEAT: 'M',
    _TYPE_PENDING: 'P',
    _TYPE_CONTENT_SERVER: 'C',
    _TYPE_CLAN: 'g',
    _TYPE_CHAT: 'T',  # Lobby 'L', Clan chat 'c'
    _TYPE_INVALID: 'I',
    _TYPE_INDIVIDUAL: 'U',
    _TYPE_ANON_USER: 'a',
}


def _strip_cdata(val: str) -> str:
    if not isinstance(val, str):
        return ""
    v = val.strip()
    if v.startswith("<![CDATA[") and v.endswith("]]>"):
        return v[len("<![CDATA["):-3].strip()
    return v


def _ensure_steam64(input_value: str) -> str:
    """Гарантированно получить steamID64 из произвольного ввода с попыткой vanity-резолва через API."""
    sid64 = parse_to_steamid64(input_value)
    if sid64:
        return sid64
    return ""


def parse_xml_value(xml_text, tag):
    # простое извлечение значения тега <tag>value</tag> с очисткой CDATA
    start = xml_text.find(f"<{tag}>")
    if start == -1:
        return ""
    start += len(tag) + 2
    end = xml_text.find(f"</{tag}>", start)
    if end == -1:
        return ""
    return _strip_cdata(xml_text[start:end])


# ===== SteamID parsing & normalization =====
_INVITE_DICT = {
    'b': '0', 'c': '1', 'd': '2', 'f': '3', 'g': '4', 'h': '5',
    'j': '6', 'k': '7', 'm': '8', 'n': '9', 'p': 'a', 'q': 'b',
    'r': 'c', 't': 'd', 'v': 'e', 'w': 'f'
}


def _decode_invite_code(code: str) -> int:
    """Декодирует invite-код из s.team/steamcommunity.com/user в accountID (32-bit)."""
    c = (code or "").strip().lower()
    # оставить только допустимые символы
    _allowed = ''.join(_INVITE_DICT.keys())
    c = re.sub(rf"[^{_allowed}-]", "", c)
    c = c.replace("-", "")
    if not c:
        raise ValueError("Empty invite code")
    # обратная подстановка в HEX
    hex_str = "".join(_INVITE_DICT.get(ch, "") for ch in c)
    if not hex_str:
        raise ValueError("Invalid invite code")
    try:
        return int(hex_str, 16)
    except Exception as e:
        raise ValueError("Invalid invite code") from e


def _accountid_to_steam64(account_id: int) -> str:
    # Универс для индивидуальных аккаунтов Public + Desktop Instance соответствует смещению ниже
    return str(76561197960265728 + int(account_id))


def _split_steam64(steam64: int):
    """Разложить steam64 на поля (account_id, instance, type, universe)."""
    account_id = steam64 & 0xFFFFFFFF
    instance = (steam64 >> 32) & 0xFFFFF
    acc_type = (steam64 >> 52) & 0xF
    universe = (steam64 >> 56) & 0xFF
    return account_id, instance, acc_type, universe


def _render_steam2(steam64: int) -> str:
    account_id, instance, acc_type, universe = _split_steam64(steam64)
    if acc_type in (_TYPE_INVALID, _TYPE_INDIVIDUAL):
        y = account_id & 1
        z = account_id >> 1
        return f"STEAM_{universe}:{y}:{z}"
    # как в библиотеке — для остальных типов просто вернуть 64бит
    return str(steam64)


def _render_steam3(steam64: int) -> str:
    account_id, instance, acc_type, universe = _split_steam64(steam64)
    acc_char = _ACCOUNT_TYPE_CHARS.get(acc_type, 'i')
    render_instance = False
    if acc_type == _TYPE_CHAT:
        if (instance & _INSTANCE_FLAG_CLAN) != 0:
            acc_char = 'c'
        elif (instance & _INSTANCE_FLAG_LOBBY) != 0:
            acc_char = 'L'
    elif acc_type in (_TYPE_ANON_GAMESERVER, _TYPE_MULTISEAT):
        render_instance = True
    result = f"[{acc_char}:{universe}:{account_id}"
    if render_instance:
        result += f":{instance}"
    result += "]"
    return result


def _render_invite_code_from_accountid(account_id: int) -> str:
    # код — hex(account_id) с заменой по словарю и дефисом посередине, если длина > 3
    hex_code = format(int(account_id), 'x')
    trans = str.maketrans({v: k for k, v in _INVITE_DICT.items()})  # обратный словарь
    # но в PHP lib используется прямая подстановка digits->letters; здесь сделаем вручную
    # digits to letters mapping (0-9a-f) -> b,c,d,f,g,h,j,k,m,n,p,q,r,t,v,w
    digits = '0123456789abcdef'
    letters = ['b','c','d','f','g','h','j','k','m','n','p','q','r','t','v','w']
    mapping = {digits[i]: letters[i] for i in range(16)}
    code = ''.join(mapping[ch] for ch in hex_code)
    if len(code) > 3:
        code = code[: len(code)//2 ] + '-' + code[len(code)//2 :]
    return code


def _invite_urls_from_code(code: str):
    return {
        "invite_code": code,
        "invite_url": f"https://steamcommunity.com/user/{code}",
        "invite_url_short": f"http://s.team/p/{code}",
    }


def parse_to_steamid64(raw: str) -> str:
    """Пытается нормализовать любой ввод в steamID64.
    Поддержка: 17-значный steamID64, 32-битный AccountID, Steam2 (STEAM_X:Y:Z),
    Steam3 ([U:1:ID]), ссылки на steamcommunity (profiles/id/user), s.team/p инвайт.
    Возвращает steamID64 или пустую строку если требуется vanity-резолвинг через XML.
    """
    if not raw:
        return ""
    s = raw.strip()

    # URL: s.team/p/<code> или steamcommunity.com/user/<code>
    m = re.search(r"https?://(?:s\.team/p|(?:my\.steamchina|steamcommunity)\.com/user)/([\w-]+)", s, re.I)
    if m:
        acc = _decode_invite_code(m.group(1))
        return _accountid_to_steam64(acc)

    # URL: steamcommunity.com/profiles/<id>
    m = re.search(r"https?://(?:my\.steamchina|steamcommunity)\.com/(?:profiles|gid)/([^/]+)", s, re.I)
    if m:
        part = m.group(1)
        # Может быть 17-значное число или Steam3 внутри
        if part.isdigit() and len(part) == 17:
            return part
        s = part  # передадим дальше в общий парсер

    # URL: steamcommunity.com/id/<vanity> или groups/games (пусть вернёт пусто — будем резолвить XML)
    if re.search(r"https?://(?:my\.steamchina|steamcommunity)\.com/(?:id|groups|games)/([\w-]+)", s, re.I):
        return ""

    # Steam3: [U:1:xxxx]
    m = re.fullmatch(r"\[([AGMPCgcLTIUai]):([0-4]):([0-9]+)(?::([0-9]+))?\]", s)
    if m:
        acc_type = m.group(1)
        if acc_type in ("U", "i"):  # individual/invalid treated as individual like lib
            account_id = int(m.group(3))
            return _accountid_to_steam64(account_id)
        # для групп/чатов не поддерживаем открытый профиль
        return ""

    # Steam2: STEAM_X:Y:Z
    m = re.fullmatch(r"STEAM_([0-4]):([01]):([0-9]{1,10})", s, re.I)
    if m:
        y = int(m.group(2))
        z = int(m.group(3))
        account_id = (z << 1) | y
        return _accountid_to_steam64(account_id)

    # Чисто 17-значный steamID64
    if s.isdigit() and len(s) == 17:
        return s

    # 32-битный accountID
    if s.isdigit() and len(s) <= 10:
        try:
            account_id = int(s)
            if 0 < account_id <= 0xFFFFFFFF:
                return _accountid_to_steam64(account_id)
        except Exception:
            pass

    # Иначе это вероятно vanity — пусть резолвится через XML
    return ""


@app.route("/api/open_profile", methods=["GET"])  # ?input=<steamid or vanity or profile URL>
def open_profile():
    """
    Получение публичных данных профиля без API-ключа через XML-интерфейс steamcommunity.
    Поддерживает: 17-значный steamID64, vanity name, а также прямые URL (id/... или profiles/...).
    Возвращает: personaname, avatarfull, profilestate (0/1), realname, profileurl, steamid.
    Остальные поля минимальны, без банов и без данных, требующих API-ключа.
    """
    raw_input = (request.args.get("input", "") or "").strip()
    if not raw_input:
        return corsify(make_response(jsonify({"error": "input is required"}), 400))

    # 1) Пробуем нормализовать ввод локально
    steamid64 = parse_to_steamid64(raw_input)

    # 2) Если не удалось — пробуем резолвить vanity через XML /id/<vanity>
    if not steamid64:
        try:
            val = raw_input.strip()
            # если пришёл URL вида /id/<vanity>, вытащим сам vanity
            m = re.search(r"https?://(?:my\.steamchina|steamcommunity)\.com/id/([\w-]+)", val, re.I)
            if m:
                val = m.group(1)
            xml = fetch_xml(f"https://steamcommunity.com/id/{val}?xml=1")
            steamid64 = parse_xml_value(xml, "steamID64")
        except Exception:
            steamid64 = ""

    if not steamid64:
        return corsify(make_response(jsonify({"error": "Cannot resolve steamID64"}), 404))

    # Загружаем публичный XML профиля
    try:
        pxml = fetch_xml(f"https://steamcommunity.com/profiles/{steamid64}?xml=1")
        personaname = parse_xml_value(pxml, "steamID") or "—"
        avatarfull = parse_xml_value(pxml, "avatarFull") or parse_xml_value(pxml, "avatarIcon")
        realname = parse_xml_value(pxml, "realname") or ""
        online_state = (parse_xml_value(pxml, "onlineState") or "").lower()
        member_since = parse_xml_value(pxml, "memberSince")
        location = parse_xml_value(pxml, "location")
        visibility_state = parse_xml_value(pxml, "visibilityState")
        state_message = parse_xml_value(pxml, "stateMessage")
        profilestate = 1 if online_state == "online" else 0
        profileurl = f"https://steamcommunity.com/profiles/{steamid64}"
        data = {
            "personaname": personaname,
            "avatarfull": avatarfull,
            "profilestate": profilestate,
            "realname": realname,
            "profileurl": profileurl,
            "steamid": steamid64,
            "member_since": member_since,
            "location": location,
            "visibility_state": visibility_state,
            "state_message": state_message,
        }
        return corsify(make_response(jsonify(data), 200))
    except Exception as e:
        return corsify(make_response(jsonify({"error": str(e)}), 500))


# ===== SteamID Info (полный набор представлений) =====
@app.route("/api/steamid_info", methods=["GET"])  # ?input=
def steamid_info():
    raw_input = (request.args.get("input", "") or "").strip()
    if not raw_input:
        return corsify(make_response(jsonify({"error": "input is required"}), 400))

    sid64 = _ensure_steam64(raw_input)
    if not (sid64 and sid64.isdigit() and len(sid64) == 17):
        return corsify(make_response(jsonify({"error": "Cannot resolve steamID64"}), 404))

    steam64_int = int(sid64)
    account_id, instance, acc_type, universe = _split_steam64(steam64_int)

    steam2 = _render_steam2(steam64_int)
    steam3 = _render_steam3(steam64_int)
    invite_code = ""
    invite_block = {}
    # Invite только для индивидуальных/invalid (как в либе)
    if acc_type in (_TYPE_INVALID, _TYPE_INDIVIDUAL):
        invite_code = _render_invite_code_from_accountid(account_id)
        invite_block = _invite_urls_from_code(invite_code)

    out = {
        "steamid64": sid64,
        "accountid": account_id,
        "steam2": steam2,
        "steam3": steam3,
        **invite_block,
        "universe": universe,
        "type": acc_type,
        "instance": instance,
    }
    return corsify(make_response(jsonify(out), 200))


# ===== Owned Games (requires API key) =====
 


# ===== Inventory (public, no key) =====
def _fetch_inventory_chunk(steamid64: str, appid: int, contextid: int = 2, start_assetid: Optional[str] = None):
    params = {
        "l": "english",
        "count": 5000,
    }
    if start_assetid:
        params["start_assetid"] = start_assetid
    url = f"https://steamcommunity.com/inventory/{steamid64}/{appid}/{contextid}"
    r = requests.get(url, params=params, timeout=30, headers={"User-Agent": "Mozilla/5.0 (compatible; FreeSteamBot/1.0)"})
    r.raise_for_status()
    return r.json()


def _inventory_merge_descriptions(assets, descriptions):
    desc_map = {}
    for d in descriptions or []:
        key = f"{d.get('classid','')}_{d.get('instanceid','0')}"
        desc_map[key] = d
    items = []
    for a in assets or []:
        key = f"{a.get('classid','')}_{a.get('instanceid','0')}"
        d = desc_map.get(key, {})
        items.append({
            "assetid": a.get("assetid"),
            "classid": a.get("classid"),
            "instanceid": a.get("instanceid"),
            "amount": int(a.get("amount", 1)),
            "name": d.get("name"),
            "market_hash_name": d.get("market_hash_name"),
            "type": d.get("type"),
            "tradable": bool(d.get("tradable")),
            "marketable": bool(d.get("marketable")),
            "icon_url": d.get("icon_url"),
        })
    return items


@app.route("/api/inventory", methods=["GET"])  # ?steamid=&appids=730,570&contextid=2
def inventory():
    steamid = (request.args.get("steamid", "") or "").strip()
    appids_raw = (request.args.get("appids", "") or "").strip()
    contextid = int(request.args.get("contextid", 2))
    if not steamid:
        return corsify(make_response(jsonify({"error": "steamid is required"}), 400))
    # нормализуем steamid
    sid64 = parse_to_steamid64(steamid) or steamid
    if not (sid64.isdigit() and len(sid64) == 17):
        return corsify(make_response(jsonify({"error": "invalid steamid"}), 400))

    if appids_raw:
        appids = [int(x) for x in appids_raw.split(',') if x.strip().isdigit()]
    else:
        appids = []

    result = {"steamid": sid64, "apps": []}
    try:
        targets = appids or [730, 570, 440]  # CS2, Dota2, TF2 как популярные по умолчанию
        for appid in targets:
            total = 0
            items = []
            start = None
            # пагинация (ограничим до 2 страниц, чтобы не перегружать)
            for _ in range(2):
                data = _fetch_inventory_chunk(sid64, appid, contextid, start)
                if not data or not data.get("success"):
                    break
                assets = data.get("assets", [])
                total += len(assets)
                items.extend(_inventory_merge_descriptions(assets, data.get("descriptions", [])))
                if data.get("more_items") and data.get("last_assetid"):
                    start = data.get("last_assetid")
                else:
                    break
            result["apps"].append({"appid": appid, "count": total, "items": items})
        return corsify(make_response(jsonify(result), 200))
    except Exception as e:
        return corsify(make_response(jsonify({"error": str(e)}), 500))


# ===== Screenshots (public, no key) =====
@app.route("/api/screenshots", methods=["GET"])  # ?steamid=
def screenshots():
    steamid = (request.args.get("steamid", "") or "").strip()
    if not steamid:
        return corsify(make_response(jsonify({"error": "steamid is required"}), 400))
    sid64 = parse_to_steamid64(steamid) or steamid
    if not (sid64.isdigit() and len(sid64) == 17):
        return corsify(make_response(jsonify({"error": "invalid steamid"}), 400))

    url = f"https://steamcommunity.com/profiles/{sid64}/screenshots/?p=1&sort=newest&browsefilter=myscreenshots"
    try:
        html = fetch_xml(url)  # reuse fetch with UA
        soup = BeautifulSoup(html, "html.parser")
        cards = soup.select(".profile_media_item .profile_media_item_content")
        out = []
        for el in cards[:12]:
            page_url = el.get("href") or ""
            img = el.select_one("img")
            thumb = img.get("src") if img else ""
            title = (img.get("alt") or "").strip() if img else ""
            out.append({"page_url": page_url, "thumb": thumb, "title": title})
        return corsify(make_response(jsonify({"steamid": sid64, "screenshots": out}), 200))
    except Exception as e:
        return corsify(make_response(jsonify({"error": str(e)}), 500))


if __name__ == "__main__":
    # Host 0.0.0.0 to allow external access if needed; default port 5000
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
