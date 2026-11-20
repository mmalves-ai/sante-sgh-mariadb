# XSD oficial do eSocial, leiaute S-1.3 (v_S_01_03_00)

- Fonte: portal do eSocial (gov.br/esocial), página "Documentação técnica", pacote
  `2026-10-26_esquemas_xsd_v_s_01_03_00-1-1.zip`, baixado em 2026-10-27 só para leitura.
- SHA-256 do zip: `0f0cc812d3fb7cdd057d3ae048356de45be81ea08ca733992b3337a0fb7c7648`.
- Arquivos copiados sem alteração (bytes originais, UTF-8 com BOM e CRLF): `tipos.xsd`, `xmldsig-core-schema.xsd` e os
  XSD dos eventos da fatia F5 (tabela: S-1000, S-1005, S-1010, S-1020; trabalhador: S-2200, S-2205, S-2206, S-2230,
  S-2299, S-2300, S-2399; exclusão: S-3000).
- Periódicos da fatia F6 (S-1200 `evtRemun.xsd`, S-1210 `evtPgtos.xsd`, S-1298 `evtReabreEvPer.xsd`, S-1299
  `evtFechaEvPer.xsd`; D-XSD-PER-537): o portal do eSocial não estava acessível desta máquina em 2026-10-28 (sem
  resolução de nome), então os quatro vieram do catálogo oficial de esquemas do banco (`FPESOCARQXSD`, namespace
  `v_S_01_03_00`, início 2024-12-02, o mais recente de cada evento), com o texto do catálogo (gravado lá em
  CP1252, convertido para UTF-8 sem BOM; quebras CRLF como no catálogo). São da publicação de 2024 do mesmo leiaute S-1.3; validam com o `tipos.xsd` acima (os tipos que mudaram de
  lugar estão definidos dentro do próprio evento). Trocar pelos do pacote oficial na próxima atualização do leiaute
  (DP-47), conferindo os periódicos de novo.
- S-2210 `evtCAT.xsd` (W0-06, CAT do SESMT): baixado em 2026-11-18 do mesmo pacote oficial
  `2026-10-26_esquemas_xsd_v_s_01_03_00-1-1.zip` (SHA-256 do zip conferido igual ao acima; `tipos.xsd` e
  `evtAfastTemp.xsd` do zip conferidos byte a byte iguais aos daqui), bytes originais. O catálogo do banco
  (`FPESOCARQXSD`) não tem o XSD do S-2210.
- `SHA256SUMS`: conferido antes de cada uso (`carregarEsquemasEsocial` em `../../xsd.ts`); arquivo alterado = validação
  recusada.
- Por que aqui e não só no catálogo do banco (FPESOCARQXSD): o catálogo tem o XSD de cada evento, mas não o `tipos.xsd`
  que todos incluem (D-XSD-536).
- Atualização: nova publicação do eSocial em pasta nova (`xsd/<versão>`), com a versão acrescentada em `LEIAUTES_ESOCIAL`
  e escolhida nos parâmetros do empregador (DP-47).
