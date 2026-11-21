"""Conector (F4): lê bases Firebird de origem, sem nunca alterá-las, para o banco próprio do cliente.

Regras (AGENTS.md 3, 4 e 5): só este pacote fala com o Firebird, e só lê; o arquivo apontado nunca é aberto
para escrita nem copiado inteiro (exceto no plano B, com guarda de disco); dados de pessoas nunca saem do
motor: logs e saídas levam só tabela, chave, regra e contagens.
"""
__version__ = "0.1.0"
