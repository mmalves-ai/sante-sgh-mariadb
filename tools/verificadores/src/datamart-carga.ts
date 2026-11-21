// Carga do data mart (M16, regra 17; ADR 0025) e o arquivo da Rede (M57, etapa 3; regra 9): funções sem efeito de
// processo, usadas pelo `pnpm datamart:carregar` e pelos testes de integração nas duas cópias.
//   - `carregarEstabelecimento`: um arquivo SQLite por estabelecimento (READ ONLY na cópia), com a dimensão
//     `estabelecimento` em todo fato e o modo do pseudônimo do paciente na carga: por estabelecimento (padrão) ou comum
//     (pela pessoa da Rede do MPI, só com a liberação `rede.pseudonimoComum` ligada em TODOS os estabelecimentos: a
//     DP-42 registrada);
//   - `consolidarRede`: o arquivo da Rede, a união dos arquivos dos estabelecimentos da rede COM o BI da Rede liberado
//     (`rede.bi`, D-LIB-BI-57: o desligado fica fora, e recolher = desligar; nenhum liberado = arquivo da Rede apagado),
//     sem nenhuma consulta cruzando os bancos (a junção é entre os arquivos já pseudonimizados), recusado se as
//     cargas não forem do mesmo esquema, do mesmo modo, da mesma chave do pseudônimo (a impressão dela) e do mesmo
//     ciclo de carga;
//   - `pseudonimoComumLiberado` e `biRedeLiberado`: a liberação lida no banco do cliente, por estabelecimento
//     (liberacao_chave e recurso_prerequisito), falha fechada (banco fora ou estabelecimento desconhecido = desligado).
// Melhoria: a liberação é lida só da chave e dos pré-requisitos do recurso pedido, filtrada no banco.
// Melhoria: sem leituras padrão do sistema de origem; a carga recebe as leituras, e as do banco recusam com o pedido.
// Antes de publicar, cada arquivo passa pelo verificador (nenhuma coluna identificadora). Nada de pessoa sai daqui.
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CHAVE_LIBERACAO_BI_REDE, CHAVE_PSEUDONIMO_COMUM_REDE, recursoDesligado } from '@sgh/contratos';
import { recursoLigadoNoEstabelecimento } from '@sgh/dominio-config';
import {
  dataDoDia,
  diaDoCenso,
  idadeEm,
  mesDoDia,
  normalizarTrajetorias,
  relogioDeParede,
} from '@sgh/dominio-internacao';
import {
  avisosDasCargasDaRede,
  colunasIdentificadoras,
  conferirCargasDaRede,
  ddlDoDataMart,
  ESQUEMA_DATAMART,
  faixaEtaria,
  impressaoDaChave,
  type ModoPseudonimo,
  pseudonimo,
  pseudonimoDoPaciente,
  sexoDoDataMart,
  TABELAS_FATO_DATAMART,
  VERSAO_ESQUEMA_DATAMART,
} from '@sgh/dominio-relatorio/datamart';
import type { MovimentoInternacao } from '@sgh/contratos';
import type { Leitor } from '@sgh/nucleo';
import { ErroIndisponivel } from './indisponivel.ts';

/**
 * O que a carga precisa do núcleo: uma leitura READ ONLY no banco do cliente, por estabelecimento (código). Um banco
 * guarda todos os estabelecimentos do cliente: o núcleo resolve o código no id do estabelecimento (recusa o código
 * desconhecido) e o entrega à leitura, que filtra por ele (`WHERE estabelecimento_id = ?`).
 */
export interface NucleoDaCarga {
  readonly rede: string;
  lerSomente<T>(
    c: { rede: string; hospital: string; traceId: string },
    fn: (l: Leitor, estabelecimentoId: number) => Promise<T>,
  ): Promise<T>;
}

export interface ResumoCarga {
  readonly estabelecimento: string;
  readonly arquivo: string;
  readonly modo: ModoPseudonimo;
  readonly internacoes: number;
  readonly pacientesDia: number;
  readonly atendimentos: number;
  readonly itens: number;
  readonly dispensacoes: number;
  /** Pacientes com pseudônimo comum (vínculo ativo no MPI; 0 no modo por estabelecimento). */
  readonly comPessoaDaRede: number;
  readonly segundos: number;
}

/** Demografia da internação (nascimento vira faixa etária na carga; nada sai como dado de pessoa). */
export interface DemografiaInternacao {
  readonly nascimento: Parameters<typeof idadeEm>[0];
  readonly sexo: Parameters<typeof sexoDoDataMart>[0];
  readonly convenio: number | string | null;
}

/** Atendimentos agregados por mês, tipo, convênio e especialidade. */
export interface AtendimentosDoMes {
  readonly mes: string;
  readonly tipo: string;
  readonly convenio: string | number | null;
  readonly especialidade: string | number | null;
  readonly quantidade: number;
}

/** Itens de conta agregados (valores somados, nunca por paciente). */
export interface ItensDaConta {
  readonly mesItem: string | null;
  readonly mesCompetencia: string | null;
  readonly tipoConta: string | null;
  readonly natureza: string | null;
  readonly convenio: string | number | null;
  readonly itens: number;
  readonly cobrado: number;
  readonly pago: number;
  readonly cobradoBaixado: number;
  readonly pagoBaixado: number;
}

/** Dispensações agregadas por mês. */
export interface DispensacoesDoMes {
  readonly mes: string;
  readonly registros: number;
  readonly quantidade: number;
}

/**
 * As leituras da carga (as do banco próprio; o teste do verificador LGPD passa as sintéticas). Cada uma recebe o id do
 * estabelecimento carregado e filtra por ele: toda leitura do banco próprio tem `WHERE estabelecimento_id = ?` (o
 * banco é do cliente inteiro; sem o filtro, o arquivo de um estabelecimento levaria os dados dos outros).
 */
export interface LeiturasDaCarga {
  movimento(l: Leitor, estabelecimentoId: number): Promise<MovimentoInternacao>;
  demografia(l: Leitor, estabelecimentoId: number): Promise<ReadonlyMap<number, DemografiaInternacao>>;
  atendimentos(l: Leitor, estabelecimentoId: number): Promise<readonly AtendimentosDoMes[]>;
  itens(l: Leitor, estabelecimentoId: number): Promise<readonly ItensDaConta[]>;
  dispensacoes(l: Leitor, estabelecimentoId: number): Promise<readonly DispensacoesDoMes[]>;
  /** Pessoa da rede (MPI) por paciente do estabelecimento; só lida no modo comum. */
  pessoas(l: Leitor, estabelecimentoId: number): Promise<ReadonlyMap<number, string>>;
}

/**
 * As leituras da carga no banco próprio: indisponíveis enquanto o contrato do movimento de internação e o motor da
 * internação usarem o formato do sistema de origem (hora HHMM, códigos de caráter e clínica). Recusa explícita.
 */
export function leiturasDoBanco(): LeiturasDaCarga {
  throw new ErroIndisponivel(
    'datamart:carregar (leituras do banco próprio)',
    'contrato MovimentoInternacao e motor da internação em vocabulário neutro (data e hora ISO, caráter, clínica e ' +
      'motivo de saída pelas tabelas de domínio) e as leituras agregadas de atendimentos, itens de conta e ' +
      'dispensações por mês, todas filtradas por estabelecimento_id',
  );
}

type LinhaChave = { escopo: string; valor: string; ligada: number | boolean | null };
type LinhaPrerequisito = { tipo: string; situacao: string; validade: string | null };
type Registrado = Parameters<typeof recursoLigadoNoEstabelecimento>[2][number];
type ChaveDoRecurso = Parameters<typeof recursoLigadoNoEstabelecimento>[0][number];

/** As chaves de liberação do recurso no estabelecimento (código), que decidem (ligada não nula). */
async function lerChavesDoRecurso(
  l: Leitor,
  estabelecimento: string,
  chave: string,
): Promise<ChaveDoRecurso[]> {
  const r = await l.consultar<LinhaChave>(
    `SELECT c.escopo, c.valor, c.ligada FROM liberacao_chave c JOIN estabelecimento e ON e.id = c.estabelecimento_id
      WHERE e.codigo = ? AND c.tipo = 'recurso' AND c.chave = ? AND c.ligada IS NOT NULL`,
    [estabelecimento, chave],
  );
  return r.map((x) => ({
    escopo: x.escopo as ChaveDoRecurso['escopo'],
    valor: String(x.valor),
    ligada: x.ligada === null ? null : Boolean(Number(x.ligada)),
  }));
}

/** Os pré-requisitos registrados do recurso no estabelecimento (código). */
async function lerPrerequisitosDoRecurso(
  l: Leitor,
  estabelecimento: string,
  chave: string,
): Promise<Registrado[]> {
  const r = await l.consultar<LinhaPrerequisito>(
    `SELECT p.tipo, p.situacao, DATE_FORMAT(p.validade, '%Y-%m-%d') AS validade
       FROM recurso_prerequisito p JOIN estabelecimento e ON e.id = p.estabelecimento_id
      WHERE e.codigo = ? AND p.recurso = ?`,
    [estabelecimento, chave],
  );
  return r.map((x) => ({
    tipo: x.tipo as Registrado['tipo'],
    situacao: x.situacao as Registrado['situacao'],
    validade: x.validade === null ? null : String(x.validade),
  }));
}

/** O arquivo de um estabelecimento na pasta do data mart. */
export const arquivoDoEstabelecimento = (pasta: string, cod: string) => resolve(pasta, `${cod}.sqlite`);
/** O arquivo da Rede (a união dos arquivos dos estabelecimentos). */
export const arquivoDaRede = (pasta: string) => resolve(pasta, 'rede.sqlite');

function conferirArquivo(db: DatabaseSync): string[] {
  const reais = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
  ).map((t) => ({
    nome: t.name,
    colunas: Object.fromEntries(
      (db.prepare(`PRAGMA table_info(${t.name})`).all() as { name: string }[]).map((c) => [
        c.name,
        'texto' as const,
      ]),
    ),
  }));
  return colunasIdentificadoras(reais);
}

/** Publica o temporário no lugar do arquivo (só depois de passar pelo verificador). */
function publicar(temporario: string, arquivo: string): void {
  const db = new DatabaseSync(temporario, { readOnly: true });
  const ruins = conferirArquivo(db);
  db.close();
  if (ruins.length > 0) {
    rmSync(temporario, { force: true });
    throw new Error(`Arquivo do data mart com coluna identificadora: ${ruins.join(', ')}`);
  }
  rmSync(arquivo, { force: true });
  renameSync(temporario, arquivo);
}

/**
 * Uma liberação de recurso no banco de cada estabelecimento (estabelecimento inteiro, com os pré-requisitos
 * cumpridos), como a API confere (ligadaNoEstabelecimento). Banco que não responde: desligado.
 */
export async function recursoLiberadoNosEstabelecimentos(
  nucleo: NucleoDaCarga,
  chave: string,
  estabelecimentos: readonly string[],
  agora: Date = new Date(),
): Promise<boolean[]> {
  const declarados = recursoDesligado(chave)?.prerequisitos ?? [];
  const r: boolean[] = [];
  for (const est of estabelecimentos)
    r.push(
      await nucleo
        .lerSomente({ rede: nucleo.rede, hospital: est, traceId: 'datamart-liberacao' }, async (l) => {
          const chaves = await lerChavesDoRecurso(l, est, chave);
          const registrados = await lerPrerequisitosDoRecurso(l, est, chave);
          return recursoLigadoNoEstabelecimento(chaves, declarados, registrados, agora);
        })
        .catch(() => false),
    );
  return r;
}

/** A liberação do pseudônimo comum (DP-42) no banco de cada estabelecimento. */
export function pseudonimoComumLiberado(
  nucleo: NucleoDaCarga,
  estabelecimentos: readonly string[],
  agora: Date = new Date(),
): Promise<boolean[]> {
  return recursoLiberadoNosEstabelecimentos(nucleo, CHAVE_PSEUDONIMO_COMUM_REDE, estabelecimentos, agora);
}

/** A liberação do BI da Rede (`rede.bi`) no banco de cada estabelecimento: só os liberados entram no arquivo da Rede. */
export function biRedeLiberado(
  nucleo: NucleoDaCarga,
  estabelecimentos: readonly string[],
  agora: Date = new Date(),
): Promise<boolean[]> {
  return recursoLiberadoNosEstabelecimentos(nucleo, CHAVE_LIBERACAO_BI_REDE, estabelecimentos, agora);
}

/** Carga de UM estabelecimento (READ ONLY na cópia) no arquivo dele. */
export async function carregarEstabelecimento(
  nucleo: NucleoDaCarga,
  opcoes: {
    readonly hospital: string;
    readonly chave: string | Buffer;
    readonly modo: ModoPseudonimo;
    readonly pasta: string;
    /** Relógio (ms, UTC real); o padrão é agora. */
    readonly agora?: number;
  },
  leituras: LeiturasDaCarga,
): Promise<ResumoCarga> {
  const { hospital, chave, modo, pasta } = opcoes;
  mkdirSync(pasta, { recursive: true });
  const arquivo = arquivoDoEstabelecimento(pasta, hospital);
  const temporario = `${arquivo}.carregando`;
  rmSync(temporario, { force: true });
  const ctx = { rede: nucleo.rede, hospital, traceId: 'datamart' };
  const t0 = performance.now();
  const mov = await nucleo.lerSomente(ctx, (l, est) => leituras.movimento(l, est));
  const demografia = await nucleo.lerSomente(ctx, (l, est) => leituras.demografia(l, est));
  const atendimentos = await nucleo.lerSomente(ctx, (l, est) => leituras.atendimentos(l, est));
  const itens = await nucleo.lerSomente(ctx, (l, est) => leituras.itens(l, est));
  const dispensacoes = await nucleo.lerSomente(ctx, (l, est) => leituras.dispensacoes(l, est));
  // A pessoa da Rede de cada prontuário só é lida no modo comum (DP-42); fica em memória (o arquivo recebe o HMAC).
  const pessoas: ReadonlyMap<number, string> =
    modo === 'comum'
      ? await nucleo.lerSomente(ctx, (l, est) => leituras.pessoas(l, est))
      : new Map<number, string>();
  const agora = relogioDeParede(opcoes.agora ?? Date.now());
  const t = normalizarTrajetorias(mov, agora);
  const unidades = new Map(mov.unidades.map((u) => [`${u.bloco}\u0000${u.acomodacao}`, u.nome]));
  const db = new DatabaseSync(temporario);
  let dias = 0;
  const comPessoa = new Set<number>();
  try {
    for (const c of ddlDoDataMart()) db.exec(c);
    db.exec('BEGIN');
    const insDia = db.prepare('INSERT INTO fato_internacao_dia VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const insInt = db.prepare(
      'INSERT INTO fato_internacao VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const diaAtual = diaDoCenso(agora, 24);
    for (const i of t.internacoes) {
      const demo = demografia.get(i.reg);
      const pessoa = pessoas.get(i.paciente) ?? null;
      if (pessoa) comPessoa.add(i.paciente);
      const pac = pseudonimoDoPaciente(chave, modo, hospital, i.paciente, pessoa);
      const int = pseudonimo(chave, `${hospital}:internacao`, i.reg);
      const faixa = faixaEtaria(idadeEm(demo?.nascimento ?? null, new Date(i.ini - (i.ini % 86_400_000))));
      const sexo = sexoDoDataMart(demo?.sexo);
      insInt.run(
        hospital,
        int,
        pac,
        mesDoDia(Math.floor(i.ini / 86_400_000)),
        i.fim === null ? null : mesDoDia(Math.floor(i.fim / 86_400_000)),
        i.urgencia ? 'urgencia' : 'eletiva',
        i.clinica,
        i.grupo,
        i.fim === null ? null : Math.round(((i.fim - i.ini) / 86_400_000) * 10) / 10,
        i.permanencia,
        i.obitoInstitucional ? 1 : 0,
        faixa,
        sexo,
        demo?.convenio === null || demo?.convenio === undefined ? null : String(demo.convenio),
      );
      for (const tr of i.trechos) {
        const d0 = Math.max(diaDoCenso(tr.ini, 24), Math.floor(Date.UTC(2020, 0, 1) / 86_400_000));
        const d1 = Math.min(tr.fim === null ? diaAtual : diaDoCenso(tr.fim, 24) - 1, diaAtual);
        for (let d = d0; d <= d1; d++) {
          insDia.run(
            hospital,
            dataDoDia(d),
            mesDoDia(d),
            unidades.get(tr.unidade) ?? tr.unidade.replace('\u0000', '/'),
            mov.tipos.get(tr.tipo) ?? String(tr.tipo),
            [3, 7, 8, 9, 17].includes(tr.tipo) ? 1 : 0,
            pac,
            int,
            i.clinica,
            faixa,
            sexo,
          );
          dias++;
        }
      }
    }
    const insAt = db.prepare('INSERT INTO fato_atendimento VALUES (?, ?, ?, ?, ?, ?)');
    for (const a of atendimentos)
      insAt.run(hospital, a.mes, a.tipo, a.convenio, a.especialidade, a.quantidade);
    const insIt = db.prepare('INSERT INTO fato_item_conta VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const x of itens)
      insIt.run(
        hospital,
        x.mesItem,
        x.mesCompetencia,
        x.tipoConta,
        x.natureza,
        x.convenio,
        x.itens,
        x.cobrado,
        x.pago,
        x.cobradoBaixado,
        x.pagoBaixado,
      );
    const insDi = db.prepare('INSERT INTO fato_dispensacao VALUES (?, ?, ?, ?)');
    for (const x of dispensacoes) insDi.run(hospital, x.mes, x.registros, x.quantidade);
    db.prepare('INSERT INTO carga VALUES (?, ?, ?, ?, ?, ?)').run(
      hospital,
      new Date(opcoes.agora ?? Date.now()).toISOString(),
      mov.dadosAte.toISOString().slice(0, 10),
      VERSAO_ESQUEMA_DATAMART,
      modo,
      impressaoDaChave(chave),
    );
    db.exec('COMMIT');
  } finally {
    db.close();
  }
  publicar(temporario, arquivo);
  return {
    estabelecimento: hospital,
    arquivo,
    modo,
    internacoes: t.internacoes.length,
    pacientesDia: dias,
    atendimentos: atendimentos.length,
    itens: itens.length,
    dispensacoes: dispensacoes.length,
    comPessoaDaRede: comPessoa.size,
    segundos: Math.round((performance.now() - t0) / 1000),
  };
}

export interface ResumoRede {
  readonly arquivo: string;
  /** null: nenhum estabelecimento com o BI da Rede liberado e carregado (o arquivo da Rede foi apagado). */
  readonly modo: ModoPseudonimo | null;
  readonly estabelecimentos: readonly string[];
  /** Os da rede com o BI da Rede desligado (fora do arquivo da Rede, mesmo com o arquivo próprio). */
  readonly foraDoBi: readonly string[];
  /** Avisos das cargas (dados até datas distantes), sem recusar. */
  readonly avisos: readonly string[];
  /** Linhas de cada fato, por estabelecimento (só contagens). */
  readonly linhas: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

function lerCarga(pasta: string, cod: string) {
  const db = new DatabaseSync(arquivoDoEstabelecimento(pasta, cod), { readOnly: true });
  try {
    const tem = new Set(
      (db.prepare('PRAGMA table_info(carga)').all() as { name: string }[]).map((c) => c.name),
    );
    const col = (c: string) => (tem.has(c) ? c : `'' AS ${c}`);
    const x = db
      .prepare(
        `SELECT estabelecimento, versao_esquema, ${col('modo_pseudonimo')}, dados_ate, carregado_em, ${col('chave_impressao')}
           FROM carga ORDER BY carregado_em DESC LIMIT 1`,
      )
      .get() as
      | {
          estabelecimento: string;
          versao_esquema: number;
          modo_pseudonimo: string;
          dados_ate: string;
          carregado_em: string;
          chave_impressao: string;
        }
      | undefined;
    return {
      estabelecimento: x?.estabelecimento ?? cod,
      versaoEsquema: Number(x?.versao_esquema ?? 0),
      modoPseudonimo: x?.modo_pseudonimo ?? '',
      dadosAte: x?.dados_ate ?? '',
      carregadoEm: x?.carregado_em ?? '',
      chaveImpressao: x?.chave_impressao ?? '',
    };
  } finally {
    db.close();
  }
}

/**
 * O arquivo da Rede: a união dos arquivos dos estabelecimentos DA REDE (a lista configurada, ARQ-1; nenhum outro) com
 * o BI da Rede LIBERADO (`liberados`, lido no banco de cada um: D-LIB-BI-57; recolher = desligar). As cargas têm de
 * ser do esquema atual, do mesmo modo de pseudônimo, da mesma chave e do mesmo ciclo (conferirCargasDaRede). Sem
 * nenhum liberado com carga, ou com a junção recusada, o arquivo da Rede é apagado (não fica um arquivo antigo com
 * quem recolheu).
 */
export function consolidarRede(
  pasta: string,
  daRede: readonly string[],
  liberados: readonly string[],
): ResumoRede {
  const arquivo = arquivoDaRede(pasta);
  const foraDoBi = daRede.filter((cod) => !liberados.includes(cod));
  const presentes = daRede.filter(
    (cod) => liberados.includes(cod) && existsSync(arquivoDoEstabelecimento(pasta, cod)),
  );
  if (presentes.length === 0) {
    rmSync(arquivo, { force: true });
    return { arquivo, modo: null, estabelecimentos: [], foraDoBi, avisos: [], linhas: {} };
  }
  const cargas = presentes.map((cod) => lerCarga(pasta, cod));
  let modo: ModoPseudonimo;
  try {
    modo = conferirCargasDaRede(cargas, daRede);
  } catch (e) {
    // Falha fechada: o arquivo da Rede anterior pode ter quem recolheu o BI; sem a junção nova, ele sai.
    rmSync(arquivo, { force: true });
    throw e;
  }
  const avisos = avisosDasCargasDaRede(cargas);
  const temporario = `${arquivo}.carregando`;
  rmSync(temporario, { force: true });
  const db = new DatabaseSync(temporario);
  const linhas: Record<string, Record<string, number>> = {};
  try {
    for (const c of ddlDoDataMart()) db.exec(c);
    presentes.forEach((cod, k) => {
      db.exec(`ATTACH DATABASE '${arquivoDoEstabelecimento(pasta, cod).replaceAll("'", "''")}' AS e${k}`);
      db.exec('BEGIN');
      linhas[cod] = {};
      for (const t of [...TABELAS_FATO_DATAMART, 'carga']) {
        const colunas = Object.keys(ESQUEMA_DATAMART.find((x) => x.nome === t)!.colunas).join(', ');
        const r = db.prepare(`INSERT INTO ${t} (${colunas}) SELECT ${colunas} FROM e${k}.${t}`).run();
        linhas[cod]![t] = Number(r.changes);
      }
      db.exec('COMMIT');
      db.exec(`DETACH DATABASE e${k}`);
    });
  } finally {
    db.close();
  }
  publicar(temporario, arquivo);
  return { arquivo, modo, estabelecimentos: presentes, foraDoBi, avisos, linhas };
}
