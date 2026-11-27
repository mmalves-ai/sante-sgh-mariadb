# Orçamento: completar-10 (27/11 14h20)

Rodada depois da revisão com o dono (decisões 52 a 60 em docs/obra/decisoes-tomadas.md). Ordem do dono: continuar até
finalizar; ao final ele testa a importação. Fora: C2-010 (login corporativo) e C2-011 (VIP), por decisão do dono. A parte
do conector (franquia da origem, C3-002, C2-003, C1-092, C1-060) vai para a sessão Painel de Injeção.

estimativa_M: 30
teto_M: 39

Base: completar-8/9 mediram 0,77 a 0,8 M por agente. Fase 1: 2 agentes de mudança compartilhada (~2 M cada). Fase 2:
32 agentes x 0,8 M ≈ 26 M.

## BRIEF da rodada

### Central de integrações externas (decisão 53 do dono; fase 1 constrói, fase 2 usa)
- Uma tela no cliente, Administração > Integrações externas, lista cada integração externa do produto (operadora TISS
  por webservice, PIX, eSocial, NFS-e, equipamentos do laboratório, webservices do SUS, push do paciente, CNES etc.).
- Cada integração tem: modo **Simulador** (padrão, claro na tela com o selo "Simulador") ou **Real**; os campos de
  credencial que o real pede (o valor vai ao cofre de segredos pelo mesmo caminho de guardarSegredoNoCofre, só na ida,
  nunca volta à tela nem ao log); endereço e parâmetros não secretos; a situação (simulador, real configurado, real com
  falha); e, quando o real depende de definição de API do fornecedor, um **aviso**: "Passe a definição à equipe de
  desenvolvimento" com a lista do que pedir ao fornecedor (manual técnico, WSDL ou OpenAPI, versão, endereços de
  homologação e produção, certificado e forma de autenticação, contato técnico).
- Ligar o Real é acionar a chave na tela, com senha de novo (crítica) e trilha. Fora de produção o real fica neutralizado
  (AGENTS.md regra 6): a chave grava, a tela avisa "neutralizado neste ambiente" e o adaptador segue no simulador.
- Contrato em packages/contratos (catálogo tipado das integrações, com o identificador, a área, os campos, o aviso e
  se o real depende de definição externa); o adaptador de cada função pergunta à central o modo e as credenciais
  (helper único da API), nunca lê process.env para credencial de cliente.
- Simulador: responde pelo contrato do serviço real (aceite, recusa, protocolo, erro de transporte) de forma
  determinística, para testes e para o hospital treinar.

### Regras de cada função da fase 2
- Função externa: ligue o adaptador à central (entrada no catálogo, simulador, aviso do fornecedor quando couber) e
  feche o que a linha da ficha pede com o simulador; o transporte real fica escrito como "pronto para a credencial" ou
  "depende da definição do fornecedor" (aviso na tela), nunca inventado.
- Função interna: feche o que a linha da ficha pede, pela causa escrita nela.
- Franquia (C2-116, decisão 56): tela das regras e lançamento na cobrança; sem dado da origem nada trava.
- Lote TISS por período (C2-035, decisão 58).
