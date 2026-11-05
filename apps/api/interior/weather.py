"""Keyless weather lookup for 小筑 via Open-Meteo.

Only current conditions and a two-day outlook are requested. Forecasts are
advisory, never a substitute for local meteorological warnings, and the caller
falls back to a plain notice when the public endpoint is unreachable.
"""

import re

import httpx

from .config import settings

DISCLAIMER = "天气数据来自 Open-Meteo 免费接口，仅供参考；台风、暴雨等以当地气象台预警为准。"

WEATHER_CODES = {
    0: "晴",
    1: "大部晴朗",
    2: "多云",
    3: "阴",
    45: "雾",
    48: "雾凇",
    51: "小毛毛雨",
    53: "毛毛雨",
    55: "强毛毛雨",
    56: "冻毛毛雨",
    57: "强冻毛毛雨",
    61: "小雨",
    63: "中雨",
    65: "大雨",
    66: "冻雨",
    67: "强冻雨",
    71: "小雪",
    73: "中雪",
    75: "大雪",
    77: "雪粒",
    80: "小阵雨",
    81: "阵雨",
    82: "强阵雨",
    85: "小阵雪",
    86: "强阵雪",
    95: "雷阵雨",
    96: "雷阵雨伴小冰雹",
    99: "雷阵雨伴大冰雹",
}

# Leading words that are not part of a city name.
CITY_PREFIXES = (
    "今天",
    "明天",
    "后天",
    "现在",
    "最近",
    "这周",
    "周末",
    "我在",
    "我是",
    "这里是",
    "请问",
    "麻烦",
    "帮我看看",
    "帮我查",
    "查一下",
    "看看",
)
CITY_PATTERN = re.compile(
    r"([\u4e00-\u9fa5]{2,12}?)\s*[，,、]?\s*"
    r"(?:(?:今天|明天|后天|现在|最近|这周|周末)\s*)?"
    r"(?:天气|气温|下雨|冷不冷|热不热|风力|空气质量|紫外线|台风|穿什么)"
)

_CITY_CACHE = {}


class WeatherError(Exception):
    """The weather endpoint failed; the assistant degrades to a plain notice."""


def fetch_json(url, params):
    try:
        response = httpx.get(
            url, params=params, timeout=settings.weather_timeout_seconds
        )
    except httpx.HTTPError as exc:
        raise WeatherError(f"天气接口不可达：{exc}") from exc
    if response.status_code >= 400:
        raise WeatherError(f"天气接口返回 HTTP {response.status_code}")
    try:
        body = response.json()
    except ValueError as exc:
        raise WeatherError("天气接口返回了无法解析的内容") from exc
    if not isinstance(body, dict):
        raise WeatherError("天气接口返回格式异常")
    return body


def _strip_prefix(value):
    changed = True
    while changed:
        changed = False
        for word in CITY_PREFIXES:
            if value.startswith(word):
                value = value[len(word) :]
                changed = True
    return value.strip("的 ，,。？?！!")


def extract_city(text):
    match = CITY_PATTERN.search(text)
    if not match:
        return None
    city = _strip_prefix(match.group(1))
    return city if len(city) >= 2 else None


def locate(city):
    key = city.casefold()
    if key in _CITY_CACHE:
        return _CITY_CACHE[key]
    body = fetch_json(
        settings.weather_geocoding_base + "/v1/search",
        {"name": city, "count": 1, "language": "zh", "format": "json"},
    )
    results = body.get("results") or []
    place = results[0] if results else None
    if not place or "latitude" not in place or "longitude" not in place:
        _CITY_CACHE[key] = None
        return None
    resolved = {
        "city": place.get("name") or city,
        "region": place.get("admin1") or "",
        "latitude": place["latitude"],
        "longitude": place["longitude"],
    }
    _CITY_CACHE[key] = resolved
    return resolved


def report(city):
    place = locate(city)
    if not place:
        return None
    body = fetch_json(
        settings.weather_api_base + "/v1/forecast",
        {
            "latitude": place["latitude"],
            "longitude": place["longitude"],
            "current": (
                "temperature_2m,apparent_temperature,precipitation,"
                "weather_code,wind_speed_10m,relative_humidity_2m"
            ),
            "daily": (
                "weather_code,temperature_2m_max,temperature_2m_min,"
                "precipitation_probability_max"
            ),
            "timezone": "auto",
            "forecast_days": 2,
        },
    )
    return {
        "place": place,
        "current": body.get("current") or {},
        "daily": body.get("daily") or {},
    }


def _code(value):
    if value is None:
        return "未知天气"
    try:
        return WEATHER_CODES.get(int(value), "未知天气")
    except (TypeError, ValueError):
        return "未知天气"


def _num(value, unit):
    if value is None:
        return "—"
    try:
        return f"{float(value):g}{unit}"
    except (TypeError, ValueError):
        return "—"


def _at(values, index, default=None):
    if isinstance(values, list) and index < len(values):
        return values[index]
    return default


def _advice(temperature, precipitation_probability, raining):
    tips = []
    if raining or (precipitation_probability or 0) >= 60:
        tips.append("出门带伞")
    if temperature is not None:
        if temperature >= 30:
            tips.append("短袖为主，注意防晒补水")
        elif temperature >= 24:
            tips.append("短袖或薄长袖")
        elif temperature >= 18:
            tips.append("长袖或薄外套")
        elif temperature >= 10:
            tips.append("外套或风衣")
        else:
            tips.append("厚外套，注意保暖")
    return "；".join(tips)


def format_report(data):
    place = data["place"]
    current = data["current"]
    daily = data["daily"]
    codes = daily.get("weather_code") or []
    highs = daily.get("temperature_2m_max") or []
    lows = daily.get("temperature_2m_min") or []
    probabilities = daily.get("precipitation_probability_max") or []
    raining = (current.get("precipitation") or 0) > 0
    lines = [
        f"**{place['city']} · 当前天气**",
        (
            f"- 现在：{_code(current.get('weather_code'))}，"
            f"{_num(current.get('temperature_2m'), ' ℃')}，"
            f"体感 {_num(current.get('apparent_temperature'), ' ℃')}，"
            f"湿度 {_num(current.get('relative_humidity_2m'), '%')}，"
            f"风速 {_num(current.get('wind_speed_10m'), ' km/h')}。"
        ),
    ]
    if codes or highs or lows:
        lines.append(
            (
                f"- 今天：{_code(_at(codes, 0))}，"
                f"{_num(_at(lows, 0), '')}–{_num(_at(highs, 0), ' ℃')}，"
                f"降水概率 {_num(_at(probabilities, 0), '%')}。"
            )
        )
    if len(codes) > 1 or len(highs) > 1:
        lines.append(
            (
                f"- 明天：{_code(_at(codes, 1))}，"
                f"{_num(_at(lows, 1), '')}–{_num(_at(highs, 1), ' ℃')}，"
                f"降水概率 {_num(_at(probabilities, 1), '%')}。"
            )
        )
    advice = _advice(
        current.get("temperature_2m"), _at(probabilities, 0), raining
    )
    if advice:
        lines.append(f"- 出行参考：{advice}。")
    lines.append(DISCLAIMER)
    return "\n".join(lines)


def answer(text):
    if not settings.weather_enabled:
        return "天气查询暂未开启，可以直接看手机天气 App。", []
    city = extract_city(text) or settings.weather_default_city.strip()
    if not city:
        return "告诉我你在哪个城市，我帮你查当前天气和今明两天的温度。", []
    data = report(city)
    if not data:
        return f"没找到「{city}」这个地名，换成城市名再试一次，例如“上海天气”。", []
    resolved = data["place"]["city"]
    return format_report(data), [
        {
            "id": "weather",
            "title": f"{resolved}天气",
            "source": "Open-Meteo 实时预报（非气象台预警）",
        }
    ]
