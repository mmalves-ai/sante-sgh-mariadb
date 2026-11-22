# Porta de arquivos (ADR 0004): API e uso pelos lotes

Código: `packages/nucleo/src/armazem-arquivos.ts` (exportado por `@sgh/nucleo`). O produto não usa S3: todo arquivo vai
para o disco da máquina, sob `ARQUIVOS_RAIZ/<banco do cliente>/<chave>`, no mesmo desenho do conector
(`migracao/<h2>/<hash>`), com o metadado na tabela `arquivo` do banco do cliente.

## Garantias

- **Gravação uma vez:** temporário com criação exclusiva (`wx`), `fsync`, `chmod 0444` e `link` atômico para o destino
  (falha se já existir). Nunca sobrescreve; destino com outro conteúdo é recusado (`arquivo-divergente`).
- **Endereçamento pelo SHA-256.** Chave: `<origem>/<estabelecimento ou 0>/<aaaa>/<mm>/<h2>/<hash>` (origem `sistema` ou
  `integracao`; a `migracao/<h2>/<hash>` é do conector).
- **Registro em `arquivo` pelo Executor** (`nucleo.arquivo.guardar`, `nucleo.arquivo.excluir`): trilha, idempotência e
  auditoria na mesma transação. Mesma chave de idempotência com outra entrada: `idempotencia-divergente`.
- **Mesmo conteúdo, mesma chave:** devolve o registro existente (`reaproveitado: true`). A tabela dona guarda o id.
- **Versão nova nunca apaga a anterior:** outro conteúdo é outro arquivo e outro registro. Não há "substituir".
- **Exclusão:** lógica no registro (`excluido_em`) e remoção do arquivo só depois do COMMIT. Recusada (`409
  arquivo-retido`) antes de `retencao_ate` e sempre para o imutável sem prazo.
- **Caminho preso na raiz:** recusa absoluto, `..`, `.`, segmento vazio e caractere fora de `[A-Za-z0-9_.-]`
  (`400 caminho-invalido`).
- **Leitura conferida:** tamanho e hash conferidos a cada leitura; falta (`arquivo-ausente`) ou divergência
  (`arquivo-divergente`) é erro 500, nunca conteúdo errado.

## API

```ts
interface ArmazemArquivos {
  guardar(entrada: EntradaGuardar, ctx: ContextoOperacao, opcoes?: OpcoesExecucao): Promise<ArquivoGuardado>;
  ler(ctx: ContextoNucleo, id: number): Promise<{ metadado: MetadadoArquivo; conteudo: Buffer }>;
  existe(ctx: ContextoNucleo, id: number): Promise<boolean>;
  metadado(ctx: ContextoNucleo, id: number): Promise<MetadadoArquivo | null>;
  verificar(ctx: ContextoNucleo, id: number): Promise<'integro' | 'faltando' | 'divergente' | 'gravavel' | 'sem_registro'>;
  excluir(id: number, versao: number, ctx: ContextoOperacao, opcoes?: OpcoesExecucao): Promise<void>;
  verificarCliente(ctx: ContextoNucleo): Promise<VerificacaoCliente>; // o vigia do worker
}

interface EntradaGuardar {
  conteudo: Uint8Array;            // não vazio, até 512 MiB (tetoBytes)
  nomeOriginal: string;            // até 255
  tipoMime: string;                // tipo/subtipo
  finalidade: string;              // snake_case: documento_assinado, anexo, imagem, logotipo, laudo...
  entidade?: string | null;        // tabela dona
  entidadeId?: number | null;
  retencaoAte?: string | null;     // AAAA-MM-DD (guarda legal)
  imutavel?: boolean;              // imutável sem prazo: nunca excluído
  origem?: 'sistema' | 'integracao';
}
// ArquivoGuardado: { id, chave, hash, tamanho, reaproveitado }
```

Fábrica: `criarArmazemLocal(nucleo, { raiz?, executor? })` (raiz padrão: `ARQUIVOS_RAIZ` do ambiente; sem ela,
`ErroConfiguracao`). Auxiliares puros: `caminhoNaRaiz`, `chaveDoArquivo`, `motivoRecusaExclusao`, `gravarUmaVez`,
`sha256`, `espacoLivreBytes`, `lerRaizArquivos`.

## Exemplo (módulo da API)

```ts
import { criarArmazemLocal, type ContextoOperacao } from '@sgh/nucleo';

const armazem = criarArmazemLocal(nucleo); // um por processo
const g = await armazem.guardar(
  {
    conteudo: pdf,
    nomeOriginal: 'prescricao.pdf',
    tipoMime: 'application/pdf',
    finalidade: 'documento_assinado',
    entidade: 'documento_emitido',
    entidadeId: documentoId,
    retencaoAte: '2046-11-21', // 20 anos (prontuário)
    imutavel: true,
  },
  ctx, // ContextoOperacao: cliente, estabelecimento, usuário, correlação, chaveIdempotencia
);
// grave g.id na coluna arquivo_id da tabela dona (pela sua operação, no Executor)
const { conteudo } = await armazem.ler(ctx, g.id);
```

Dentro de uma operação maior, passe `{ escritor: tx }` em `opcoes` (a gravação do registro entra no SAVEPOINT da sua
transação; a exclusão do arquivo só acontece fora dela).

## Testes

```ts
import { criarPastaArquivosTeste, criarArmazemLocal } from '@sgh/nucleo';
let pasta: PastaArquivosTeste;
beforeAll(async () => { pasta = await criarPastaArquivosTeste(); }); // por SGH_CLIENTE_TESTE
afterAll(() => pasta.apagar());
const armazem = criarArmazemLocal(nucleo, { raiz: pasta.raiz });
```

Nada de container `sgh-s3` nem bucket de teste.

## Instalação e worker

- `ARQUIVOS_RAIZ` (obrigatória) e `ARQUIVOS_ALERTA_LIVRE_GB` (padrão 20) em `tools/instalacao/src/variaveis.ts`.
  `conferir-ambiente.ts` (instalar e atualizar) recusa caminho relativo, pasta ausente, sem leitura e escrita, gravável
  por todos ou de outro dono, e alerta espaço livre abaixo do limite.
- `S3_*` saíram do arquivo do servidor; ficam em `NAO_CONFIGURAVEIS` ("em retirada") enquanto os módulos não migram.
- Worker: `vigia-arquivos` (`VIGIA_ARQUIVOS=desligado` desliga; `VIGIA_ARQUIVOS_MS`, padrão 6 h) confere o hash de cada
  registro contra o disco e alerta falta, divergência, somente leitura perdido e espaço baixo (só ids e contagens).
- DDL: `db/migracoes/00_NUCLEO/22_tabelas.sql` (comentário de `chave_armazenamento`: "Caminho relativo na raiz de
  arquivos"). A coluna `versao_objeto` (da 21) não é usada: a versão é o hash.

## Decisões pela melhor prática (para o dono ver)

1. Disco primeiro, registro depois: se o registro falhar, sobra um arquivo sem registro, nunca servido (toda leitura
   parte do registro). O inverso (registro sem arquivo) seria pior.
2. Mesmo conteúdo no mesmo mês e estabelecimento reaproveita o registro (a chave é única no banco).
3. Regra da exclusão (`motivoRecusaExclusao`) fica no núcleo, junto da porta: é invariante de armazenamento, não regra
   de um domínio.
4. O auxiliar de testes (`criarPastaArquivosTeste`) é exportado pelo núcleo porque a API (tipo `api`) não pode depender
   do pacote `testes`; só usa pasta temporária.
