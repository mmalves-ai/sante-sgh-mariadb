"""Guarda de disco do motor: recusa iniciar se o livre estimado DEPOIS da carga ficar abaixo da reserva (100 GB).

Estimativa = tamanho do arquivo de origem × fator (plano, seção 5: ~75 GB no MariaDB para 48 GB de origem, ~1,6).
O livre é medido no sistema de arquivos do volume de trabalho, o mesmo dos volumes Docker do MariaDB nesta VM.
Variáveis: CONECTOR_RESERVA_GB (100), CONECTOR_FATOR_DISCO_IMPORTAR (1.6), CONECTOR_FATOR_DISCO_SINCRONIZAR (0.2),
CONECTOR_DISCO_DIR (padrão: o diretório de trabalho).
"""
import os
import shutil

FATOR_PADRAO = {"importar": 1.6, "sincronizar": 0.2}


class DiscoInsuficiente(RuntimeError):
    pass


def verificar(tipo, tamanho_origem, caminho=None, reserva_gb=None, fator=None):
    caminho = caminho or os.environ.get("CONECTOR_DISCO_DIR") or os.environ.get("CONECTOR_TRABALHO_DIR", "/trabalho")
    reserva_gb = float(reserva_gb if reserva_gb is not None else os.environ.get("CONECTOR_RESERVA_GB", 100))
    if fator is None:
        fator = float(os.environ.get("CONECTOR_FATOR_DISCO_" + tipo.upper(), FATOR_PADRAO[tipo]))
    livre = shutil.disk_usage(caminho).free
    necessario = int(tamanho_origem * fator)
    sobra = livre - necessario
    r = {"livre_gb": round(livre / 1e9, 1), "necessario_gb": round(necessario / 1e9, 1),
         "sobra_gb": round(sobra / 1e9, 1), "reserva_gb": reserva_gb, "fator": fator}
    if sobra < reserva_gb * 1e9:
        raise DiscoInsuficiente("guarda de disco: livre %.1f GB, carga estimada %.1f GB, sobraria %.1f GB (< reserva "
                                "%g GB)" % (r["livre_gb"], r["necessario_gb"], r["sobra_gb"], reserva_gb))
    return r
