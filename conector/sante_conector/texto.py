"""Conversão determinística CP1252 -> texto Unicode (gravado depois como utf8mb4).

A origem usa charset NONE com bytes em CP1252. Os cinco bytes sem caractere no CP1252 (0x81, 0x8D, 0x8F,
0x90, 0x9D) viram o controle C1 de mesmo código (U+0081...), como no padrão WHATWG; assim a conversão é
total, sem erro e reversível. O hash da linha é sempre calculado sobre os bytes crus, antes da conversão.
"""
import codecs

_TABELA = []
for _b in range(256):
    try:
        _TABELA.append(bytes([_b]).decode("cp1252"))
    except UnicodeDecodeError:
        _TABELA.append(chr(_b))
_REVERSA = {c: b for b, c in enumerate(_TABELA)}


def cp1252_para_texto(b, aparar=False):
    if b is None:
        return None
    s = "".join(_TABELA[x] for x in b)
    return s.rstrip(" ") if aparar else s


def texto_para_cp1252(s):
    return bytes(_REVERSA[c] for c in s)
