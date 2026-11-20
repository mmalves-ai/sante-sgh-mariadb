# F7. Serrano e hospital do zero

**Objetivo:** levar o Serrano para o sistema novo e tornar o produto instalável num hospital que não vem
do SPDATA.

**Entra:** F6 concluída (ProntoCardio em produção).
**Sai (portão):** Serrano em produção no sistema novo; instalação de um hospital novo, do zero, em
ambiente de teste, com o roteiro documentado.

---

### F7.1 Virada do Serrano (`hs`)

- **Entregas:**
  - mesmo roteiro da F5 e da F6 para o banco `hs`;
  - **índice único de pacientes** da Rede: paciente presente em `pc` e em `hs` unificado pelo vínculo do
    índice, quando houver, e os pares prováveis na fila de pendências, nunca unidos automaticamente.
- **Aceite:** o portão da F6 aplicado ao Serrano.

### F7.2 Instalação de hospital novo

- **Entregas:**
  - **Banco do hospital criado do zero** (banco por hospital, ADR 0002):
    - migrações;
    - catálogos públicos;
    - estrutura física;
    - usuários iniciais.
  - **Assistente de implantação:** estabelecimento, CNES, convênios, tabelas de preço e parâmetros.
  - **Licenças de catálogo** carregadas só com comprovação.
- **Aceite:** instalação de ponta a ponta em ambiente de teste, cronometrada e documentada.

### F7.3 Recursos exigidos para vender

- **Entregas:** os itens marcados **F7** na análise (F1.1): o que um hospital novo exige mesmo que a Rede
  Santé não use (obrigações fiscais, TISS completo, regulatórios).
- **Aceite:** contrato de efeito e E2E de cada item.
