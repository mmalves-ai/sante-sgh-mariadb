# Central de integrações externas (decisão 53 do dono)

Como cada função externa liga o seu adaptador à central. Leitura obrigatória dos agentes da fase 2 da completar-10.

## O que existe

| Peça | Onde |
|---|---|
| Catálogo tipado (id, área, campos de credencial, parâmetros, `dependeDefinicaoFornecedor`, `oQuePedirAoFornecedor`) | `packages/contratos/src/integracao/externas.ts` (`CATALOGO_INTEGRACOES_EXTERNAS`) |
| Regras puras (situação, modo efetivo, simulador comum determinístico) | `packages/dominio-integracao/src/integracoes-externas.ts` |
| Tabela por cliente (`configuracao_integracao_externa`) | `db/migracoes/17_INTG/99_integracao_externa_tabelas.sql` |
| Porta (banco pelo Executor, memória na fonte sintética), serviço e helper | `apps/api/src/modulos/integracao/externas/` |
| Rotas | `GET /api/administracao/integracoes-externas`; `POST .../parametros`, `.../credencial` e `.../modo` (as duas últimas com a senha de novo) |
| Permissões (perfil `administrador-sistema`) | `config.integracaoExterna.ler` e `config.integracaoExterna.gerir` |

Entradas do catálogo: `operadora-tiss-webservice` (elegibilidade, autorização, comunicação de internação e alta, envio de
lote), `pix`, `esocial`, `nfse`, `equipamentos-laboratorio`, `sus-webservices`, `push-paciente`, `cnes`,
`regulacao-central`.

## Como ligar um adaptador (passo a passo)

1. **Entrada no catálogo.** Se a função não tem entrada, acrescente uma em `CATALOGO_INTEGRACOES_EXTERNAS` (id em
   minúsculas com hífen, campos de credencial, parâmetros, `dependeDefinicaoFornecedor` e o que pedir ao fornecedor;
   comece por `PEDIDO_PADRAO_FORNECEDOR`). Se já existe, acrescente a sua função em `funcoes`. O arquivo é
   compartilhado: commit só do seu trecho.
2. **Pergunte o modo à central**, nunca ao ambiente:

   ```ts
   import { modoDaIntegracao } from '../integracao/externas/servico.js';
   const m = await modoDaIntegracao('pix');
   if (m.modo === 'simulador') return simular(pedido); // padrão, e sempre fora de produção
   const segredo = await m.credencial('client-secret'); // só no real; nunca em log, tela ou trilha
   const endereco = m.parametros['endereco'];
   ```

   - `m.modo` é `real` só em produção, com o real ligado na tela e completo (parâmetros obrigatórios e todas as
     credenciais no cofre). Em qualquer outro caso é `simulador`. `m.neutralizado` diz que o real foi ligado fora de
     produção.
   - Falha do real (tempo esgotado, recusa do transporte): `await m.registrarFalha('motivo sem dado de pessoa')`. A
     tela passa a mostrar "Real com falha".
3. **Simulador.** Responda pelo contrato do serviço real (aceite, recusa, protocolo, erro de transporte), de forma
   determinística. O comum é `respostaSimulada(integracao, chave)` de `@sgh/dominio-integracao`: chave terminada em
   `-recusa` é recusada, em `-erro` falha no transporte, o resto é aceito com protocolo `SIM-...` estável. Use-o ou um
   simulador próprio com a mesma propriedade.
4. **Transporte real.** Escreva só o que o padrão público define. Quando depende da definição do fornecedor
   (`dependeDefinicaoFornecedor: true`), deixe o transporte como "depende da definição do fornecedor" (a tela já mostra
   o aviso e a lista do que pedir). Nunca invente endereço, WSDL ou formato.
5. **Testes.** Unidade com `ligarCentralIntegracoes(null)` (simulador) e com um `ServicoIntegracoesExternas` sobre
   `PortaIntegracoesExternasMemoria` + `CofreMemoria` em `producao: true` para o caminho real (ver
   `externas/servico.spec.ts`). No E2E sem banco, a central responde pela porta em memória; as gravações críticas
   (senha de novo) são servidas pelo spec seguindo o contrato.

## Regras

- A credencial vai ao cofre pela referência `cofre:integracao/<cliente>/<integração>/<campo>` (só os campos do
  catálogo são aceitos). Nunca volta à tela: o painel diz só "definida" ou não.
- Ligar o real exige a senha de novo e justificativa (trilha). Fora de produção grava, a tela avisa "neutralizado neste
  ambiente" e o adaptador segue no simulador (AGENTS.md, regra 6).
- `TRANSPORTE_TISS_PRODUCAO_CONFIGURADO` e `provedorPixDoAmbiente` são anteriores à central: a função dona de cada um
  passa a decidir pela central (`modoDaIntegracao`) e deixa a constante e a variável de ambiente só como trava extra.
