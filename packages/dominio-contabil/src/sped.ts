// SPED contábil (M54-F3; ficha, seções 2 e 6; chave `contabil.sped`, desligada por padrão): a ECD (Escrituração
// Contábil Digital, leiaute 9) e a ECF (Escrituração Contábil Fiscal) das entidades imunes e isentas, geradas a partir
// da contabilidade própria. Regras puras: a entrada é o plano, os saldos iniciais e os lançamentos do exercício já lidos;
// a saída é o texto do arquivo (registros com "|", linhas com CRLF), a contagem por registro e os impedimentos.
//   - O exercício precisa dos 12 meses encerrados e da apuração do resultado (senão o balanço do bloco J não fecha);
//     toda conta analítica com saldo ou movimento precisa do vínculo com o plano referencial (I051/J051).
//   - A aglutinação das demonstrações (I052, J100, J150) é a conta de nível 2 do plano, a mesma das parcelas da DRE e
//     do balanço da tela; o nível 1 é o totalizador.
//   - Sem centro de custo na ECD nem na ECF (I100 e COD_CCUS vazios; D-CCUS-543).
//   - O leiaute não foi conferido no validador oficial (PVA): o arquivo sai com `leiauteConferido = false` até a
//     controladoria validar, e a chave fica desligada (POL-3).
import {
  type ContaPlano,
  type FormaTributacaoEcf,
  FORMAS_ECF_GERADAS,
  type GrupoConta,
  type ImpedimentoContabil,
  type LadoPartida,
  LEIAUTE_ECD,
  LEIAUTE_ECF,
  QUALIFICACOES_SIGNATARIO,
  type ResumoRegistrosSped,
  type SignatarioSped,
  type TipoLancamento,
} from '@sgh/contratos';
import { aglutinacaoDe, eGrupoDeResultado, type SomaConta } from './demonstracoes.js';
import { compararCodigos, nivelDoCodigo, paiDoCodigo } from './plano.js';

/** Dados cadastrais da empresa (do cadastro de empresas do banco; nada de pessoa). */
export interface EmpresaSped {
  readonly codigo: number;
  readonly nome: string;
  readonly cnpj: string | null;
  readonly uf: string | null;
  readonly inscricaoEstadual: string | null;
  readonly codigoMunicipio: string | null;
  readonly municipio: string | null;
  readonly inscricaoMunicipal: string | null;
  readonly nire: string | null;
  readonly dataNire: string | null;
  readonly endereco: string | null;
  readonly numero: string | null;
  readonly complemento: string | null;
  readonly bairro: string | null;
  readonly cep: string | null;
  readonly telefone: string | null;
  readonly email: string | null;
  readonly cnae: string | null;
  /** Código do plano referencial (catálogo da Receita) dos vínculos das contas. */
  readonly planoReferencial: string | null;
  /** Natureza jurídica (ECF 0030 COD_NAT, 4 dígitos). */
  readonly naturezaJuridica: string | null;
}

export interface PartidaSped {
  readonly lado: LadoPartida;
  readonly conta: string;
  readonly valorCentavos: number;
  readonly historico: string;
}

export interface LancamentoSped {
  readonly id: number;
  readonly data: string;
  readonly tipo: TipoLancamento;
  readonly historico: string;
  /** Lançamento de apuração (ou o estorno de uma apuração): entra como encerramento ("E"). */
  readonly encerramento: boolean;
  readonly partidas: readonly PartidaSped[];
}

export interface EntradaSped {
  readonly exercicio: number;
  readonly empresa: EmpresaSped;
  readonly plano: readonly ContaPlano[];
  /** Saldos (débitos e créditos acumulados) de cada conta antes de 1º de janeiro do exercício. */
  readonly saldosIniciais: readonly SomaConta[];
  /** Todos os lançamentos do exercício, em ordem de data e número. */
  readonly lancamentos: readonly LancamentoSped[];
  /** Competências do exercício encerradas (AAAA-MM). */
  readonly encerradas: ReadonlySet<string>;
  readonly signatarios: readonly SignatarioSped[];
  readonly numeroOrdem: number;
  readonly substituta: boolean;
  readonly hashAnterior: string | null;
  /** A leitura dos lançamentos foi cortada pelo teto (o arquivo não sai incompleto). */
  readonly parcial: boolean;
}

export interface EntradaEcf extends EntradaSped {
  readonly formaTributacao: FormaTributacaoEcf;
  readonly tipoEntidade: string;
}

export interface ArquivoGerado {
  readonly impedimentos: ImpedimentoContabil[];
  readonly avisos: string[];
  /** O texto (vazio quando há impedimento). */
  readonly conteudo: string;
  readonly linhas: number;
  readonly registros: ResumoRegistrosSped[];
  readonly nomeArquivo: string;
}

// ── Formatação ───────────────────────────────────────────────────────────────────────────────────

const CRLF = '\r\n';
/** Data AAAA-MM-DD → DDMMAAAA. */
export const dataSped = (d: string): string => `${d.slice(8, 10)}${d.slice(5, 7)}${d.slice(0, 4)}`;
/** Centavos (sem sinal) → "1234,56". */
export const valorSped = (c: number): string => {
  const a = Math.abs(Math.trunc(c));
  return `${Math.trunc(a / 100)},${String(a % 100).padStart(2, '0')}`;
};
/** O campo não pode ter "|" nem quebra de linha. */
const campo = (v: string | number | null | undefined): string =>
  v === null || v === undefined
    ? ''
    : String(v)
        .replace(/\s*[|\r\n]+\s*/g, ' ')
        .trim();
const dc = (saldoDevedor: number): 'D' | 'C' => (saldoDevedor < 0 ? 'C' : 'D');
const ultimoDia = (comp: string) => {
  const [a, m] = comp.split('-').map(Number) as [number, number];
  return `${comp}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
const competencias = (exercicio: number) =>
  Array.from({ length: 12 }, (_, i) => `${exercicio}-${String(i + 1).padStart(2, '0')}`);

/** COD_NAT do plano de contas (I050/J050): 01 ativo, 02 passivo, 03 PL, 04 resultado, 05 compensação. */
export function naturezaSped(g: GrupoConta): string {
  if (g === 'ativo') return '01';
  if (g === 'passivo') return '02';
  if (g === 'patrimonioLiquido') return '03';
  if (g === 'compensacao') return '05';
  return '04';
}

class Escritor {
  readonly linhas: string[] = [];
  readonly contagem = new Map<string, number>();
  reg(...c: (string | number | null | undefined)[]) {
    const r = String(c[0]);
    this.linhas.push(`|${c.map(campo).join('|')}|`);
    this.contagem.set(r, (this.contagem.get(r) ?? 0) + 1);
  }
  /** Linhas do bloco cujo registro começa com o prefixo (inclui o de abertura e o de encerramento). */
  doBloco(prefixo: string): number {
    let n = 0;
    for (const [r, q] of this.contagem) if (r.startsWith(prefixo)) n += q;
    return n;
  }
  /** Fecha com o bloco 9 (9001, 9900 por registro, 9990, 9999) e devolve o texto. */
  fechar(): { conteudo: string; registros: ResumoRegistrosSped[] } {
    this.reg('9001', '0');
    const tipos = [...this.contagem.keys(), '9900', '9990', '9999'];
    const n9900 = tipos.length;
    for (const r of tipos) {
      const q = r === '9900' ? n9900 : r === '9990' || r === '9999' ? 1 : (this.contagem.get(r) ?? 0);
      this.linhas.push(`|9900|${r}|${q}|`);
    }
    this.contagem.set('9900', n9900);
    // 9990: linhas do bloco 9 (9001 + 9900s + 9990 + 9999).
    this.reg('9990', 1 + n9900 + 2);
    const total = this.linhas.length + 1;
    this.reg('9999', total);
    const registros = [...this.contagem].map(([registro, quantidade]) => ({ registro, quantidade }));
    return { conteudo: this.linhas.join(CRLF) + CRLF, registros };
  }
}

// ── Saldos do exercício ──────────────────────────────────────────────────────────────────────────

interface SaldosMes {
  ini: number;
  d: number;
  c: number;
}

/** Saldo inicial, débitos e créditos de cada conta analítica em cada mês (e o saldo antes da apuração). */
function saldosDoExercicio(e: EntradaSped) {
  const ini = new Map<string, number>();
  for (const s of e.saldosIniciais) ini.set(s.conta, (ini.get(s.conta) ?? 0) + s.debitos - s.creditos);
  const porMes = new Map<string, Map<string, { d: number; c: number }>>();
  const antesApuracao = new Map<string, number>();
  for (const l of e.lancamentos) {
    const comp = l.data.slice(0, 7);
    let m = porMes.get(comp);
    if (!m) {
      m = new Map();
      porMes.set(comp, m);
    }
    for (const p of l.partidas) {
      const x = m.get(p.conta) ?? { d: 0, c: 0 };
      if (p.lado === 'D') x.d += p.valorCentavos;
      else x.c += p.valorCentavos;
      m.set(p.conta, x);
      if (!l.encerramento)
        antesApuracao.set(
          p.conta,
          (antesApuracao.get(p.conta) ?? 0) + (p.lado === 'D' ? p.valorCentavos : -p.valorCentavos),
        );
    }
  }
  const contas = new Set<string>([...ini.keys()]);
  for (const m of porMes.values()) for (const k of m.keys()) contas.add(k);
  const meses = new Map<string, Map<string, SaldosMes>>();
  const corrente = new Map(ini);
  for (const comp of competencias(e.exercicio)) {
    const m = porMes.get(comp) ?? new Map<string, { d: number; c: number }>();
    const r = new Map<string, SaldosMes>();
    for (const k of contas) {
      const s0 = corrente.get(k) ?? 0;
      const x = m.get(k) ?? { d: 0, c: 0 };
      r.set(k, { ini: s0, d: x.d, c: x.c });
      corrente.set(k, s0 + x.d - x.c);
    }
    meses.set(comp, r);
  }
  return { ini, meses, final: corrente, contas, antesApuracao };
}

// ── Impedimentos comuns ──────────────────────────────────────────────────────────────────────────

function impedimentosComuns(
  e: EntradaSped,
  contas: ReadonlySet<string>,
): {
  impedimentos: ImpedimentoContabil[];
  avisos: string[];
} {
  const impedimentos: ImpedimentoContabil[] = [];
  const avisos: string[] = [];
  const imp = (codigo: string, mensagem: string, quantidade = 1) =>
    impedimentos.push({ codigo, mensagem, quantidade });
  const noPlano = new Map(e.plano.map((c) => [c.codigo, c]));
  if (e.parcial)
    imp(
      'leitura-parcial',
      'O exercício tem mais lançamentos do que a geração lê de uma vez: nada foi gerado.',
    );
  if (!e.empresa.cnpj || !/^\d{14}$/.test(e.empresa.cnpj))
    imp('sem-cnpj', 'A empresa não tem CNPJ no cadastro de empresas.');
  if (!e.empresa.uf) imp('sem-uf', 'A empresa não tem a UF no cadastro de empresas.');
  if (!e.empresa.codigoMunicipio || !/^\d{7}$/.test(e.empresa.codigoMunicipio))
    imp('sem-municipio', 'A empresa não tem o código IBGE do município no cadastro de empresas.');
  if (!e.empresa.planoReferencial)
    imp('sem-plano-referencial', 'Escolha o plano referencial das contas (vínculo no plano de contas).');
  const abertas = competencias(e.exercicio).filter((c) => !e.encerradas.has(c));
  if (abertas.length > 0)
    imp(
      'meses-abertos',
      `Encerre todos os meses do exercício antes de gerar: ${abertas.map((c) => `${c.slice(5)}/${c.slice(0, 4)}`).join(', ')}.`,
      abertas.length,
    );
  const comResultado = [...contas].some((k) => {
    const g = noPlano.get(k)?.grupo;
    return g !== undefined && eGrupoDeResultado(g);
  });
  if (comResultado && !e.lancamentos.some((l) => l.encerramento && l.tipo === 'apuracao'))
    imp('sem-apuracao', `Apure o resultado do exercício de ${e.exercicio} antes de gerar.`);
  const semRef = [...contas].filter((k) => {
    const c = noPlano.get(k);
    return (
      c !== undefined && c.tipo === 'analitica' && (c.referencialConta === null || c.referencialTipo === null)
    );
  });
  if (semRef.length > 0)
    imp(
      'sem-referencial',
      `Contas com saldo ou movimento sem o vínculo com o plano referencial: ${semRef.slice(0, 10).join(', ')}${semRef.length > 10 ? '…' : ''}.`,
      semRef.length,
    );
  const fora = [...contas].filter((k) => !noPlano.has(k));
  if (fora.length > 0)
    imp(
      'fora-do-plano',
      `Contas com movimento que não estão no plano: ${fora.slice(0, 10).join(', ')}.`,
      fora.length,
    );
  const contador = e.signatarios.filter((s) => s.qualificacao === '900');
  if (contador.length === 0) imp('sem-contador', 'Entre os signatários, o contador (qualificação 900).');
  const outros = e.plano.filter(
    (c) => c.tipo === 'analitica' && c.referencialConta === null && !contas.has(c.codigo),
  );
  if (outros.length > 0)
    avisos.push(
      `${outros.length} conta(s) analítica(s) sem referencial e sem saldo: ficam no plano do arquivo.`,
    );
  return { impedimentos, avisos };
}

/** As contas do plano que vão ao arquivo: as com saldo ou movimento e todas as sintéticas acima delas. */
function contasDoArquivo(e: EntradaSped, contas: ReadonlySet<string>): ContaPlano[] {
  const noPlano = new Map(e.plano.map((c) => [c.codigo, c]));
  const r = new Set<string>();
  for (const k of contas) {
    let x: string | null = k;
    while (x) {
      if (noPlano.has(x)) r.add(x);
      x = paiDoCodigo(x);
    }
  }
  return [...r].sort(compararCodigos).map((k) => noPlano.get(k)!);
}

const signatarioPrincipal = (s: readonly SignatarioSped[]) => s.find((x) => x.qualificacao !== '900');

// ── ECD ──────────────────────────────────────────────────────────────────────────────────────────

const MARCA_LINHAS = '\u0000QTD_LIN\u0000';

export function gerarEcd(e: EntradaSped): ArquivoGerado {
  const s = saldosDoExercicio(e);
  const { impedimentos, avisos } = impedimentosComuns(e, s.contas);
  const nomeArquivo = `ECD_${e.empresa.cnpj ?? 'SEM_CNPJ'}_${e.exercicio}${e.substituta ? '_SUBSTITUTA' : ''}.txt`;
  if (impedimentos.length > 0)
    return { impedimentos, avisos, conteudo: '', linhas: 0, registros: [], nomeArquivo };
  const ini = `${e.exercicio}-01-01`;
  const fim = `${e.exercicio}-12-31`;
  const emp = e.empresa;
  const w = new Escritor();
  const noPlano = new Map(e.plano.map((c) => [c.codigo, c]));
  // Bloco 0
  w.reg(
    '0000',
    'LECD',
    dataSped(ini),
    dataSped(fim),
    emp.nome,
    emp.cnpj,
    emp.uf,
    emp.inscricaoEstadual,
    emp.codigoMunicipio,
    emp.inscricaoMunicipal,
    '',
    '0',
    emp.nire ? '1' : '0',
    e.substituta ? '1' : '0',
    e.substituta ? e.hashAnterior : '',
    '0',
    '0',
    '',
    'N',
    'N',
    '0',
    '0',
    emp.planoReferencial,
  );
  w.reg('0001', '0');
  w.reg('0007', '00', '');
  w.reg('0990', w.doBloco('0') + 1);
  // Bloco I
  w.reg('I001', '0');
  w.reg('I010', 'G', LEIAUTE_ECD);
  w.reg(
    'I030',
    'TERMO DE ABERTURA',
    e.numeroOrdem,
    'DIARIO GERAL',
    MARCA_LINHAS,
    emp.nome,
    emp.nire,
    emp.cnpj,
    emp.dataNire ? dataSped(emp.dataNire) : '',
    '',
    emp.municipio,
    dataSped(fim),
  );
  const contasArquivo = contasDoArquivo(e, s.contas);
  for (const c of contasArquivo) {
    const pai = paiDoCodigo(c.codigo);
    w.reg(
      'I050',
      dataSped(ini),
      naturezaSped(c.grupo),
      c.tipo === 'analitica' ? 'A' : 'S',
      nivelDoCodigo(c.codigo),
      c.codigo,
      pai && noPlano.has(pai) ? pai : '',
      c.nome,
    );
    if (c.tipo === 'analitica') {
      if (c.referencialConta) w.reg('I051', '', c.referencialConta);
      w.reg('I052', '', aglutinacaoDe(c.codigo));
    }
  }
  const analiticas = contasArquivo.filter((c) => c.tipo === 'analitica').map((c) => c.codigo);
  for (const comp of competencias(e.exercicio)) {
    const m = s.meses.get(comp)!;
    w.reg('I150', dataSped(`${comp}-01`), dataSped(ultimoDia(comp)));
    for (const k of analiticas) {
      const x = m.get(k);
      if (!x) continue;
      const fin = x.ini + x.d - x.c;
      if (x.ini === 0 && x.d === 0 && x.c === 0) continue;
      w.reg(
        'I155',
        k,
        '',
        valorSped(x.ini),
        dc(x.ini),
        valorSped(x.d),
        valorSped(x.c),
        valorSped(fin),
        dc(fin),
      );
    }
  }
  for (const l of e.lancamentos) {
    const valor = l.partidas.filter((p) => p.lado === 'D').reduce((t, p) => t + p.valorCentavos, 0);
    w.reg('I200', l.id, dataSped(l.data), valorSped(valor), l.encerramento ? 'E' : 'N', '');
    for (const p of l.partidas)
      w.reg('I250', p.conta, '', valorSped(p.valorCentavos), p.lado, '', '', p.historico || l.historico, '');
  }
  // I350/I355: saldos das contas de resultado antes do encerramento (na data da apuração).
  const resultado = analiticas.filter((k) => eGrupoDeResultado(noPlano.get(k)!.grupo));
  if (resultado.length > 0) {
    w.reg('I350', dataSped(fim));
    for (const k of resultado) {
      const v = (s.ini.get(k) ?? 0) + (s.antesApuracao.get(k) ?? 0);
      if (v !== 0) w.reg('I355', k, '', valorSped(v), dc(v));
    }
  }
  w.reg('I990', w.doBloco('I') + 1);
  // Bloco J: balanço (J100) e DRE (J150) pela aglutinação de nível 2.
  w.reg('J001', '0');
  w.reg('J005', dataSped(ini), dataSped(fim), '1', '');
  const agl = new Map<string, { ini: number; fin: number }>();
  const aglDre = new Map<string, number>();
  for (const k of analiticas) {
    const c = noPlano.get(k)!;
    const a = aglutinacaoDe(k);
    const raiz = k.split('.')[0]!;
    const i0 = s.ini.get(k) ?? 0;
    const f0 = s.final.get(k) ?? 0;
    if (eGrupoDeResultado(c.grupo)) {
      const v = s.antesApuracao.get(k) ?? 0;
      aglDre.set(a, (aglDre.get(a) ?? 0) + v);
      aglDre.set(raiz, (aglDre.get(raiz) ?? 0) + v);
    } else if (c.grupo !== 'compensacao') {
      for (const alvo of [a, raiz]) {
        const y = agl.get(alvo) ?? { ini: 0, fin: 0 };
        y.ini += i0;
        y.fin += f0;
        agl.set(alvo, y);
      }
    }
  }
  for (const [k, v] of [...agl].sort(([a], [b]) => compararCodigos(a, b))) {
    const c = noPlano.get(k);
    const g = c?.grupo ?? 'ativo';
    const nivel = nivelDoCodigo(k);
    w.reg(
      'J100',
      k,
      nivel === 1 ? 'T' : 'D',
      nivel,
      nivel === 1 ? '' : k.split('.')[0],
      g === 'ativo' ? 'A' : 'P',
      c?.nome ?? k,
      valorSped(v.ini),
      dc(v.ini),
      valorSped(v.fin),
      dc(v.fin),
      '',
    );
  }
  let ordem = 0;
  for (const [k, v] of [...aglDre].sort(([a], [b]) => compararCodigos(a, b))) {
    const c = noPlano.get(k);
    const nivel = nivelDoCodigo(k);
    ordem += 1;
    w.reg(
      'J150',
      ordem,
      k,
      nivel === 1 ? 'T' : 'D',
      nivel,
      nivel === 1 ? '' : k.split('.')[0],
      c?.nome ?? k,
      valorSped(0),
      'D',
      valorSped(v),
      dc(v),
      v < 0 ? 'R' : 'D',
      '',
    );
  }
  w.reg(
    'J900',
    'TERMO DE ENCERRAMENTO',
    e.numeroOrdem,
    'DIARIO GERAL',
    emp.nome,
    MARCA_LINHAS,
    dataSped(ini),
    dataSped(fim),
  );
  const principal = signatarioPrincipal(e.signatarios);
  for (const sg of e.signatarios)
    w.reg(
      'J930',
      sg.nome,
      sg.cpf,
      QUALIFICACOES_SIGNATARIO[sg.qualificacao],
      sg.qualificacao,
      sg.crc ?? '',
      sg.email ?? '',
      sg.telefone ?? '',
      '',
      '',
      '',
      sg === principal ? 'S' : 'N',
    );
  w.reg('J990', w.doBloco('J') + 1);
  const { conteudo, registros } = w.fechar();
  const total = w.linhas.length;
  return {
    impedimentos,
    avisos,
    conteudo: conteudo.split(MARCA_LINHAS).join(String(total)),
    linhas: total,
    registros,
    nomeArquivo,
  };
}

// ── ECF (imunes e isentas) ───────────────────────────────────────────────────────────────────────

export function gerarEcf(e: EntradaEcf): ArquivoGerado {
  const s = saldosDoExercicio(e);
  const { impedimentos, avisos } = impedimentosComuns(e, s.contas);
  const nomeArquivo = `ECF_${e.empresa.cnpj ?? 'SEM_CNPJ'}_${e.exercicio}${e.substituta ? '_RETIFICADORA' : ''}.txt`;
  if (!FORMAS_ECF_GERADAS.includes(e.formaTributacao))
    impedimentos.push({
      codigo: 'forma-nao-gerada',
      mensagem:
        'A ECF do lucro real ou do presumido (apuração do IRPJ e da CSLL) não é gerada pelo Sante: gere-a no programa da Receita com a ECD transmitida.',
      quantidade: 1,
    });
  if (!e.empresa.naturezaJuridica)
    avisos.push('A empresa não tem a natureza jurídica no cadastro (registro 0030).');
  if (impedimentos.length > 0)
    return { impedimentos, avisos, conteudo: '', linhas: 0, registros: [], nomeArquivo };
  const ini = `${e.exercicio}-01-01`;
  const fim = `${e.exercicio}-12-31`;
  const emp = e.empresa;
  const noPlano = new Map(e.plano.map((c) => [c.codigo, c]));
  const w = new Escritor();
  w.reg(
    '0000',
    'LECF',
    LEIAUTE_ECF,
    emp.cnpj,
    emp.nome,
    '0',
    '0',
    '',
    '',
    dataSped(ini),
    dataSped(fim),
    e.substituta ? 'S' : 'N',
    e.substituta ? e.hashAnterior : '',
    '0',
    '',
  );
  w.reg('0001', '0');
  w.reg(
    '0010',
    e.substituta ? e.hashAnterior : '',
    'N',
    e.formaTributacao,
    '',
    '',
    '',
    '',
    '',
    e.tipoEntidade,
    '',
    '',
    '',
  );
  w.reg('0020', '', '0', ...Array.from({ length: 31 }, () => 'N'));
  w.reg(
    '0030',
    emp.naturezaJuridica,
    emp.cnae,
    emp.endereco,
    emp.numero,
    emp.complemento,
    emp.bairro,
    emp.uf,
    emp.codigoMunicipio,
    emp.cep,
    emp.telefone,
    emp.email,
  );
  for (const sg of e.signatarios)
    w.reg('0930', sg.nome, sg.cpf, sg.qualificacao, sg.crc ?? '', sg.email ?? '', sg.telefone ?? '');
  w.reg('0990', w.doBloco('0') + 1);
  // Bloco J: o plano e o referencial.
  w.reg('J001', '0');
  const contasArquivo = contasDoArquivo(e, s.contas);
  for (const c of contasArquivo) {
    const pai = paiDoCodigo(c.codigo);
    w.reg(
      'J050',
      dataSped(ini),
      naturezaSped(c.grupo),
      c.tipo === 'analitica' ? 'A' : 'S',
      nivelDoCodigo(c.codigo),
      c.codigo,
      pai && noPlano.has(pai) ? pai : '',
      c.nome,
    );
    if (c.tipo === 'analitica' && c.referencialConta) w.reg('J051', '', c.referencialConta);
  }
  w.reg('J990', w.doBloco('J') + 1);
  // Bloco K: saldos patrimoniais (K155/K156) e de resultado antes do encerramento (K355/K356), anuais.
  w.reg('K001', '0');
  w.reg('K030', dataSped(ini), dataSped(fim), 'A00');
  const analiticas = contasArquivo.filter((c) => c.tipo === 'analitica');
  const refPat = new Map<string, { ini: number; d: number; c: number }>();
  const refRes = new Map<string, number>();
  for (const c of analiticas) {
    const k = c.codigo;
    let d = 0;
    let cr = 0;
    for (const m of s.meses.values()) {
      const x = m.get(k);
      if (x) {
        d += x.d;
        cr += x.c;
      }
    }
    const i0 = s.ini.get(k) ?? 0;
    const fin = i0 + d - cr;
    if (eGrupoDeResultado(c.grupo)) continue;
    if (i0 === 0 && d === 0 && cr === 0) continue;
    w.reg('K155', k, '', valorSped(i0), dc(i0), valorSped(d), valorSped(cr), valorSped(fin), dc(fin));
    const r = c.referencialConta ?? '';
    const y = refPat.get(r) ?? { ini: 0, d: 0, c: 0 };
    y.ini += i0;
    y.d += d;
    y.c += cr;
    refPat.set(r, y);
    w.reg('K156', r, valorSped(i0), dc(i0), valorSped(d), valorSped(cr), valorSped(fin), dc(fin));
  }
  for (const c of analiticas) {
    if (!eGrupoDeResultado(c.grupo)) continue;
    const v = (s.ini.get(c.codigo) ?? 0) + (s.antesApuracao.get(c.codigo) ?? 0);
    if (v === 0) continue;
    w.reg('K355', c.codigo, '', valorSped(v), dc(v));
    w.reg('K356', c.referencialConta ?? '', valorSped(v), dc(v));
    const r = c.referencialConta ?? '';
    refRes.set(r, (refRes.get(r) ?? 0) + v);
  }
  w.reg('K990', w.doBloco('K') + 1);
  // Bloco U (imunes e isentas): balanço (U100) e resultado (U150) pelo plano referencial, só as contas analíticas
  // referenciais usadas (as sintéticas do referencial ficam com o programa oficial: o banco não guarda as contas dele).
  w.reg('U001', '0');
  w.reg('U030', dataSped(ini), dataSped(fim), 'A00');
  for (const [r, y] of [...refPat].sort(([a], [b]) => a.localeCompare(b))) {
    const fin = y.ini + y.d - y.c;
    w.reg(
      'U100',
      r,
      r,
      'A',
      r.split('.').length,
      '',
      '',
      valorSped(y.ini),
      dc(y.ini),
      valorSped(y.d),
      valorSped(y.c),
      valorSped(fin),
      dc(fin),
    );
  }
  for (const [r, v] of [...refRes].sort(([a], [b]) => a.localeCompare(b)))
    w.reg('U150', r, r, 'A', r.split('.').length, '04', '', valorSped(v), dc(v));
  w.reg('U990', w.doBloco('U') + 1);
  const { conteudo, registros } = w.fechar();
  avisos.push(
    'Bloco U com as contas analíticas do plano referencial; o programa oficial completa as sintéticas na importação.',
  );
  return { impedimentos, avisos, conteudo, linhas: w.linhas.length, registros, nomeArquivo };
}

/** Envio anterior da mesma escrituração (empresa, tipo e exercício) para planejar o próximo. */
export interface EnvioSpedAnterior {
  readonly id: number;
  readonly numero: number;
  readonly situacao: 'gerado' | 'transmitido' | 'cancelado';
  /** Já apontado por outro envio não cancelado. */
  readonly substituido: boolean;
}

export type PlanoEnvioSped =
  | {
      readonly ok: true;
      readonly numero: number;
      /** O envio que o novo aponta como substituído (null: nenhum). */
      readonly substituidoId: number | null;
      /** O apontado era um gerado pendente (não transmitido nem substituído): passa a substituído. */
      readonly substituiPendente: boolean;
    }
  | { readonly ok: false; readonly motivo: 'sem-arquivo-substituido' };

/**
 * Número e substituição do próximo envio do SPED (regra única das portas de memória e do banco). O número é o maior
 * já usado mais um (cancelados contam). A escrituração substituta aponta o último envio válido (gerado ou
 * transmitido) e é recusada sem envio anterior; a nova geração original substitui o último gerado ainda pendente.
 */
export function planejarEnvioSped(envios: readonly EnvioSpedAnterior[], substituta: boolean): PlanoEnvioSped {
  const ordenados = [...envios].sort((a, b) => b.numero - a.numero);
  const numero = (ordenados[0]?.numero ?? 0) + 1;
  const vivo = ordenados.find((e) => e.situacao !== 'cancelado');
  const pendente = ordenados.find((e) => e.situacao === 'gerado' && !e.substituido);
  const alvo = substituta ? vivo : pendente;
  if (substituta && !alvo) return { ok: false, motivo: 'sem-arquivo-substituido' };
  return {
    ok: true,
    numero,
    substituidoId: alvo?.id ?? null,
    substituiPendente: alvo !== undefined && alvo.situacao === 'gerado' && !alvo.substituido,
  };
}
