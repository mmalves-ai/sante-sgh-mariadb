// pnpm imutabilidade:gerar -- [--conferir]
// M59-F3 (ficha do M59, regra 6): regrava a lista gerada das tabelas clínicas (a partir do DDL do modelo próprio) e
// confere o repositório (código das portas e migrações sem DELETE clínico fora das exceções). Nunca grava no banco.
// Com --conferir, só confere (sai 1 se desatualizado). Sem tabela clínica reconhecida no modelo, recusa (sai 1).
// Melhoria (ADR 0003): o par de scripts de REVOKE da conta do banco de origem (--conta) saiu; no banco próprio a
// imutabilidade por privilégio é concessão por tabela à conta da aplicação (pedido registrado no lote 05-10).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { lerArgumentos } from './argumentos.ts';
import {
  CAMINHO_TABELAS_CLINICAS,
  ErroSemTabelasClinicas,
  MODULOS_CLINICOS_DDL,
  decisorDeleteClinico,
  gerarTabelasClinicas,
  grantsDeleteClinicoSgh,
  operacoesComDeleteClinico,
  scriptsSghDoRepositorio,
  tabelasClinicasDoModelo,
} from './imutabilidade.ts';
import { ErroIndisponivel } from './indisponivel.ts';
import { gerarArtefatos, RAIZ } from './privilegios.ts';

const { opcoes, bandeiras } = lerArgumentos(process.argv.slice(2));
if (opcoes['conta']?.trim()) {
  console.error(
    new ErroIndisponivel(
      'imutabilidade:gerar --conta',
      'concessões por tabela à conta da aplicação no MariaDB (DELETE só nas tabelas fora da lista clínica)',
    ).message,
  );
  process.exit(1);
}
// A guarda decide pela lista clínica do modelo próprio (DDL); sem nenhuma tabela reconhecida, recusa (nunca verde).
let decide: (t: string) => boolean;
try {
  const clinicas = tabelasClinicasDoModelo();
  decide = decisorDeleteClinico(clinicas);
  console.log(
    `${clinicas.length} tabela(s) clínica(s) reconhecida(s) no modelo (db/migracoes/{${MODULOS_CLINICOS_DDL.join(',')}} e núcleo)`,
  );
} catch (e) {
  console.error(
    e instanceof ErroSemTabelasClinicas ? e.message : `lista clínica do modelo: ${(e as Error).message}`,
  );
  process.exit(1);
}
const achados = [
  ...operacoesComDeleteClinico(undefined, decide),
  ...grantsDeleteClinicoSgh(scriptsSghDoRepositorio(), decide),
];
for (const a of achados) console.error(`DELETE clínico: ${a.origem} ${a.onde} → ${a.tabela}`);
let falha = achados.length > 0;
try {
  gerarArtefatos(opcoes['hospital'] ?? 'pc');
} catch (e) {
  console.error((e as Error).message);
  falha = true;
}
// A lista do contrato sai do DDL do modelo próprio (a mesma que a guarda usa), nunca dos nomes da origem.
const caminho = resolve(RAIZ, CAMINHO_TABELAS_CLINICAS);
const texto = gerarTabelasClinicas();
let emDia = existsSync(caminho) && readFileSync(caminho, 'utf8') === texto;
if (!emDia && !bandeiras.has('conferir')) {
  writeFileSync(caminho, texto);
  console.log(`gravado: ${CAMINHO_TABELAS_CLINICAS}`);
  emDia = true;
}
if (bandeiras.has('conferir') && !emDia)
  console.error(`desatualizado: ${CAMINHO_TABELAS_CLINICAS} (rode pnpm imutabilidade:gerar)`);
process.exit(falha || !emDia ? 1 : 0);
