"""Fatia L8-06 (faturamento e restantes, módulo FAT): declarações planejadas, regras das colunas e coerência da
imagem sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em `conector.sh conferir-fatia L8-06`."""
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_06

TABELAS = set(l8_06.CARREGADAS)
BLOQUEADAS = {"FCCTAAUD", "FCCTAEXT", "FCFAIPAC", "FCIRREGULARID", "FCLANAUD", "FCLANEXT", "FCLANEXTSEQITEM",
              "REPROEXT", "RICONTAS", "RIPROEXT", "TBREPGER", "FCINTEGRPA", "TBREPGER_TBCBOPRO", "FCTISSLOTEPROT",
              "FCCTAEXT_FCTISSLOTEPROT", "HTPROCTO", "TBHISTBR", "TBHISTTABDTH", "TBHISTTABMM", "TBHISTTABTHME",
              "TBHISTTABTHMI"}
E = "endpoint_tiss_fonte_pagadora"


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, TABELAS | BLOQUEADAS)}

    def cols(self):
        return {c["destino"]: c for c in self.plano["TBTISSWEBSERV"]["colunas"][E]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        # só o endereço: a credencial (segundo destino) espera o cofre de segredos (pedido 9)
        self.assertEqual(self.plano["TBTISSWEBSERV"]["destinos"], [E])

    def test_obrigatorias_e_referencias(self):
        cs = self.cols()
        self.assertTrue({"estabelecimento_id", "fonte_pagadora_id", "forma_envio", "url"} <= set(cs))
        self.assertEqual(cs["estabelecimento_id"]["coluna"], "@estabelecimento")
        self.assertEqual(cs["forma_envio"]["coluna"], "=servico_web")
        self.assertEqual(cs["fonte_pagadora_id"]["coluna"], "ID_TBCONVEN")
        self.assertEqual(cs["transacao_tiss_webservice_id"]["coluna"], "ID_TBTISSSCHEMA")
        self.assertEqual(cs["tipo_autenticacao"]["depara"], "valores")
        self.assertEqual(cs["tipo_autenticacao"]["regra"], "booleano_sn")
        via = [c["via"] for c in self.mapa["colunas_decl"]
               if c["tabela"] == "TBTISSWEBSERV" and c["coluna"] == "ID_TBTISSSCHEMA"]
        self.assertEqual(via, ["obrigatoria"])  # transação nunca vista: recusa, nunca NULL (pedido 12)
        if l8_06.REFERENCIA_OBRIGATORIA:
            self.assertTrue(cs["transacao_tiss_webservice_id"].get("obrigatoria"))
            self.assertFalse(cs["fonte_pagadora_id"].get("obrigatoria"))

    def test_segredo_nunca_vai_ao_banco(self):
        lidas = {c["coluna"] for c in self.mapa["colunas_decl"] if c["tabela"] == "TBTISSWEBSERV"}
        self.assertFalse({"SENHA_PRESTADOR", "SENHA_PRESTADOR_PADRAO_HASH_MD5", "LOGIN_PRESTADOR"} & lidas)
        self.assertNotIn("referencia_cofre", self.cols())

    def test_pares_de_autenticacao(self):
        c = self.cols()["tipo_autenticacao"]
        v = c["valores"]
        self.assertEqual(set(v.values()), {"basica", "nenhuma"})
        self.assertEqual(len(v), 3)  # verdadeiro, falso e o nulo

        def dest(cru):  # mesma ordem do motor: regra, depois o par
            x, pr = sentinela.aplicar(c["regra"], cru)
            if pr:
                return None, pr
            k = "" if x is None else ("1" if x is True else "0" if x is False else str(x))
            return (v[k], None) if k in v else (None, "valor_fora_do_dominio")
        for cru, esp in [(b"S", "basica"), (b"s", "basica"), (b"N", "nenhuma"), (b"n", "nenhuma"),
                         (None, "nenhuma")]:
            self.assertEqual(dest(cru), (esp, None), cru)
        self.assertEqual(dest(b"X"), (None, "valor_fora_do_dominio"))

    def test_bloqueadas_sem_declaracao(self):
        # dependem de regra genérica, de alimentadora ou de decisão do dono (docs/obra/fatias/f4/saida/L8-06.json)
        self.assertFalse(BLOQUEADAS & set(self.plano))
        self.assertFalse([c for c in self.mapa["colunas_decl"] if c["tabela"] in BLOQUEADAS])


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto", b"  https://x.exemplo.invalid/ws  "), ("https://x.exemplo.invalid/ws", None))
        self.assertEqual(a("texto", b"   "), (None, None))
        self.assertEqual(a("codigo_char", b"S"), ("S", None))


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l8_06.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        self.assertTrue(set(l8_06.NAO_CARREGADAS) <= set(cont))
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith(("restricao_destino_", "pai_pendente")))
            # transação nunca vista para a mesma fonte, duas vezes: recusadas com a referência obrigatória
            recusas += 2 if l8_06.REFERENCIA_OBRIGATORIA else 0
            self.assertEqual(cont[t], e["gravados"] + recusas, t)
