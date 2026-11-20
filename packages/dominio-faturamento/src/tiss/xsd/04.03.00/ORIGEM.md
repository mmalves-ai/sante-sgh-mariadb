# XSD oficial do Padrão TISS 04.03.00 (Componente de Comunicação)

- Fonte: ANS, página "Padrão TISS – setembro 2026" (gov.br/ans), arquivo do Componente de Comunicação
  `PadroTISSComunicao_202511.zip` (versões 04.03.00 e 01.06.00), baixado em 2026-10-19 só para leitura.
- SHA-256 do zip: `db8640e1c3b87085892f54f838bfcea9934439ff365798c8428559f88c13d62d`.
- Arquivos copiados sem alteração (bytes originais, ISO-8859-1 com CRLF): os seis `.xsd` desta pasta; os
  `.wsdl` e o `tissWebServicesV4_03_00.xsd` ficam de fora (webservice não é usado fora de produção, regra 1.10).
- `SHA256SUMS`: conferido pelo validador antes de cada uso (`carregarEsquemas` em `validacao.ts`); arquivo alterado = validação recusada.
- Atualização: só com nova publicação da ANS e ADR `0014-gerador-xml-tiss` revisto.
