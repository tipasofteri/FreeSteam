from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import re
import xml.etree.ElementTree as ET
import json
import os
from datetime import datetime
import logging

app = Flask(__name__)
CORS(app)

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Steam API конфигурация
STEAM_API_BASE = "https://steamcommunity.com"
STEAM_ID_PATTERN = re.compile(r'^7656119[0-9]{10}$')

class SteamUtils:
    """Утилиты для работы с Steam ID"""
    
    @staticmethod
    def to_steam_id64(steam_id_input):
        """Конвертирует различные форматы Steam ID в SteamID64"""
        if not steam_id_input:
            return None
            
        # Если уже SteamID64
        if STEAM_ID_PATTERN.match(str(steam_id_input)):
            return str(steam_id_input)
        
        # Если это AccountID (32-bit)
        try:
            account_id = int(steam_id_input)
            if 0 < account_id < 2**32:
                return str(account_id + 76561197960265728)
        except (ValueError, TypeError):
            pass
        
        # Если это SteamID формата STEAM_0:Y:Z
        steam_id_match = re.match(r'^STEAM_([01]):([01]):(\d+)$', str(steam_id_input))
        if steam_id_match:
            universe, y, z = map(int, steam_id_match.groups())
            account_id = z * 2 + y
            return str(account_id + 76561197960265728)
        
        # Если это SteamID3 формата [U:1:Z]
        steam_id3_match = re.match(r'^\[U:1:(\d+)\]$', str(steam_id_input))
        if steam_id3_match:
            account_id = int(steam_id3_match.group(1))
            return str(account_id + 76561197960265728)
        
        return None
    
    @staticmethod
    def steam_id64_to_all_formats(steam_id64):
        """Конвертирует SteamID64 во все форматы"""
        try:
            steam_id64 = int(steam_id64)
            account_id = steam_id64 - 76561197960265728
            
            if account_id < 0:
                return None
            
            # SteamID (STEAM_0:Y:Z)
            y = account_id % 2
            z = account_id // 2
            steam_id = f"STEAM_0:{y}:{z}"
            
            # SteamID3
            steam_id3 = f"[U:1:{account_id}]"
            
            # FiveM HEX
            fivem_hex = f"steam:{hex(steam_id64)[2:]}"
            
            return {
                'steamid64': str(steam_id64),
                'steamid': steam_id,
                'steamid3': steam_id3,
                'steamid32': str(account_id),
                'account_id': str(account_id),
                'fivem_hex': fivem_hex
            }
        except (ValueError, TypeError):
            return None

@app.route('/api/health', methods=['GET'])
def health_check():
    """Проверка здоровья API"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.utcnow().isoformat(),
        'version': '1.0.0'
    })

@app.route('/api/steamid_info', methods=['GET'])
def steamid_info():
    """Получить информацию о Steam ID и конвертации"""
    steam_input = request.args.get('input', '').strip()
    
    if not steam_input:
        return jsonify({'error': 'Параметр input обязателен'}), 400
    
    # Попробуем извлечь Steam ID из URL
    if 'steamcommunity.com' in steam_input:
        # Проверим на vanity URL
        vanity_match = re.search(r'steamcommunity\.com/id/([^/?#]+)', steam_input)
        if vanity_match:
            return jsonify({'error': 'Vanity URL поддержка требует Steam API ключ'}), 400
        
        # Проверим на прямой SteamID64
        profile_match = re.search(r'steamcommunity\.com/profiles/(\d+)', steam_input)
        if profile_match:
            steam_input = profile_match.group(1)
    
    steam_id64 = SteamUtils.to_steam_id64(steam_input)
    if not steam_id64:
        return jsonify({'error': 'Неверный формат Steam ID'}), 400
    
    formats = SteamUtils.steam_id64_to_all_formats(steam_id64)
    if not formats:
        return jsonify({'error': 'Ошибка конвертации Steam ID'}), 500
    
    # Добавляем дополнительные URL
    base_url = f"https://steamcommunity.com/profiles/{steam_id64}"
    formats.update({
        'profileurl': base_url,
        'invite_url': f"{base_url}?i=1",
        'invite_url_short': f"s.team/p/{formats['account_id']}"
    })
    
    return jsonify(formats)

@app.route('/api/open_profile', methods=['GET'])
def open_profile():
    """Получить публичную информацию профиля Steam через XML"""
    steam_input = request.args.get('input', '').strip()
    
    if not steam_input:
        return jsonify({'error': 'Параметр input обязателен'}), 400
    
    # Определяем тип входных данных
    steam_id64 = None
    
    if 'steamcommunity.com' in steam_input:
        # Vanity URL
        vanity_match = re.search(r'steamcommunity\.com/id/([^/?#]+)', steam_input)
        if vanity_match:
            vanity_name = vanity_match.group(1)
            xml_url = f"{STEAM_API_BASE}/id/{vanity_name}/?xml=1"
        
        # Profile URL
        profile_match = re.search(r'steamcommunity\.com/profiles/(\d+)', steam_input)
        if profile_match:
            steam_id64 = profile_match.group(1)
            xml_url = f"{STEAM_API_BASE}/profiles/{steam_id64}/?xml=1"
    else:
        # Попробуем конвертировать в SteamID64
        steam_id64 = SteamUtils.to_steam_id64(steam_input)
        if steam_id64:
            xml_url = f"{STEAM_API_BASE}/profiles/{steam_id64}/?xml=1"
        else:
            # Возможно это vanity name
            xml_url = f"{STEAM_API_BASE}/id/{steam_input}/?xml=1"
    
    try:
        response = requests.get(xml_url, timeout=10)
        response.raise_for_status()
        
        # Парсим XML
        root = ET.fromstring(response.content)
        
        # Проверяем на ошибки
        error_elem = root.find('error')
        if error_elem is not None:
            return jsonify({'error': 'Профиль не найден или приватный'}), 404
        
        # Извлекаем данные
        profile_data = {}
        
        # Базовая информация
        profile_data['steamid'] = root.findtext('steamID64')
        profile_data['personaname'] = root.findtext('steamID')
        profile_data['profileurl'] = root.findtext('profileURL', '')
        profile_data['avatarfull'] = root.findtext('avatarFull', '')
        profile_data['realname'] = root.findtext('realname', '')
        profile_data['location'] = root.findtext('location', '')
        profile_data['profilestate'] = 1 if root.findtext('onlineState') == 'online' else 0
        
        # Даты
        member_since = root.findtext('memberSince')
        if member_since:
            profile_data['member_since'] = member_since
        
        # Конвертируем Steam ID в разные форматы
        if profile_data['steamid']:
            formats = SteamUtils.steam_id64_to_all_formats(profile_data['steamid'])
            if formats:
                profile_data.update(formats)
        
        # Дополнительная информация (если доступна)
        profile_data['vanity_url'] = ''
        if 'steamcommunity.com/id/' in steam_input:
            vanity_match = re.search(r'steamcommunity\.com/id/([^/?#]+)', steam_input)
            if vanity_match:
                profile_data['vanity_url'] = vanity_match.group(1)
        
        return jsonify(profile_data)
        
    except requests.RequestException as e:
        logger.error(f"Ошибка запроса к Steam: {e}")
        return jsonify({'error': 'Ошибка получения данных от Steam'}), 500
    except ET.ParseError as e:
        logger.error(f"Ошибка парсинга XML: {e}")
        return jsonify({'error': 'Ошибка обработки данных профиля'}), 500
    except Exception as e:
        logger.error(f"Неожиданная ошибка: {e}")
        return jsonify({'error': 'Внутренняя ошибка сервера'}), 500

@app.route('/api/inventory', methods=['GET'])
def get_inventory():
    """Получить инвентарь пользователя (базовая реализация)"""
    steam_id64 = request.args.get('steamid')
    app_ids = request.args.get('appids', '730,570')  # CS:GO, Dota 2 по умолчанию
    context_id = request.args.get('contextid', '2')
    
    if not steam_id64:
        return jsonify({'error': 'Параметр steamid обязателен'}), 400
    
    steam_id64 = SteamUtils.to_steam_id64(steam_id64)
    if not steam_id64:
        return jsonify({'error': 'Неверный Steam ID'}), 400
    
    # Заглушка - в реальной реализации нужен Steam API ключ
    return jsonify({
        'message': 'Функция инвентаря требует Steam API ключ',
        'steamid': steam_id64,
        'requested_apps': app_ids.split(','),
        'context_id': context_id
    })

@app.route('/api/screenshots', methods=['GET'])
def get_screenshots():
    """Получить скриншоты профиля (базовая реализация)"""
    steam_id64 = request.args.get('steamid')
    
    if not steam_id64:
        return jsonify({'error': 'Параметр steamid обязателен'}), 400
    
    steam_id64 = SteamUtils.to_steam_id64(steam_id64)
    if not steam_id64:
        return jsonify({'error': 'Неверный Steam ID'}), 400
    
    # Заглушка - в реальной реализации можно парсить публичные скриншоты
    return jsonify({
        'message': 'Функция скриншотов в разработке',
        'steamid': steam_id64,
        'screenshots': []
    })

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Эндпоинт не найден'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Внутренняя ошибка сервера'}), 500

if __name__ == '__main__':
    # Для разработки
    app.run(debug=True, host='127.0.0.1', port=5000)
