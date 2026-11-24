// Porta do faturamento SUS em memória, etapa 4 (AIH): a sessão sintética de dev/ci (E2E). A massa é SINTÉTICA (nenhum
// dado de pessoa): em qualquer competência pedida, duas internações do SUS (convênio 1) com alta nela — uma clínica de
// dez dias com três diárias na UTI e um OPM, outra curta, sem UTI — e um catálogo SIGTAP sintético da AIH. As gravações
// seguem as regras das tabelas do faturamento SUS (versão e situação de origem em cada mudança; número único; o retorno não duplica);
// a transação é a da porta em memória (desfeita se a função falhar).
import { recusa } from '@sgh/nucleo';
import type { DadosAihLidos, GravacaoSusAih, LeituraSusAih, SolicitanteAihLido } from './porta-aih.js';
import {
  type AihRegistro,
  ErroAih,
  type FaixaAih,
  type InternacaoAih,
  type ItemAih,
  type ItemContaAih,
  type PassagemLeito,
  type RetornoSus,
} from './tipos.js';

export interface EstadoSusAih {
  faixas: FaixaAih[];
  aihs: AihRegistro[];
  itens: (ItemAih & { aih: number; fechamento: number })[];
  retornos: RetornoSus[];
}

export function estadoAihVazio(): EstadoSusAih {
  return { faixas: [], aihs: [], itens: [], retornos: [] };
}

/** O que a parte da AIH usa da porta em memória (o estado, a sequência, o arquivo e a linha do BPA). */
export interface BaseMemoriaAih {
  aih(): EstadoSusAih;
  proximo(): number;
  inserirArquivo(a: Parameters<GravacaoSusAih['gravarArquivoSisaih']>[0]): Promise<{ substituidos: number }>;
  linhaBpa(
    competencia: string,
    p: { tipo: 'c' | 'i'; folha: number; sequencia: number },
  ): { linha: number; arquivo: number; procedimento: string } | null;
}

const agora = () => new Date().toISOString().slice(0, 23);

/** Catálogo SIGTAP sintético da AIH (códigos de forma válida; nomes inventados) e o registro de cada um. */
export const SIGTAP_AIH_SINTETICO = [
  {
    id: 9003,
    codigo: '0406010811',
    nome: 'PROCEDIMENTO SINTETICO DE INTERNACAO',
    registro: '03',
    permanencia: 6,
  },
  { id: 9011, codigo: '0303060212', nome: 'TRATAMENTO CLINICO SINTETICO', registro: '03', permanencia: 4 },
  {
    id: 9012,
    codigo: '0211020036',
    nome: 'ELETROCARDIOGRAMA SINTETICO DA AIH',
    registro: '05',
    permanencia: null,
  },
  { id: 9013, codigo: '0702040061', nome: 'OPM SINTETICO', registro: '04', permanencia: null },
  {
    id: 9014,
    codigo: '0802010083',
    nome: 'DIARIA SINTETICA DE UTI ADULTO',
    registro: '04',
    permanencia: null,
  },
] as const;

/** Os médicos solicitantes SUS sintéticos da AIH (CPF gerado pelo algoritmo; o E2E usa o primeiro). */
export const SOLICITANTES_AIH_SINTETICOS: readonly SolicitanteAihLido[] = [
  { cpf: '00000000191', nome: 'MEDICO SOLICITANTE SINTETICO DA AIH', cns: null },
];

/** Os tipos de UTI do SIH sintéticos e os leitos habilitados (o tipo 2 com 10 leitos). */
export const LEITOS_UTI_SINTETICOS = [
  { tipo: 1, nome: 'ADULTO 1 (SINTETICO)', leitos: 0 },
  { tipo: 2, nome: 'ADULTO 2 (SINTETICO)', leitos: 10 },
] as const;

/** As duas internações SUS sintéticas da competência (registros 7401 e 7402). */
export const REGISTROS_AIH_SINTETICOS = [7401, 7402] as const;

function cnsSinteticoAih(semente: number): string {
  for (let k = 0; k < 1000; k++) {
    const corpo = `7${String(semente * 1000 + k).padStart(14, '0')}`;
    let t = 0;
    for (let i = 0; i < 15; i++) t += Number(corpo[i]) * (15 - i);
    if (t % 11 === 0) return corpo;
  }
  throw new Error('sem CNS sintético');
}

export function internacoesAihSinteticas(inicio: string): {
  internacoes: InternacaoAih[];
  itens: ItemContaAih[];
  passagens: PassagemLeito[];
} {
  const dia = (d: number) => `${inicio.slice(0, 8)}${String(d).padStart(2, '0')}`;
  const internacao = (n: 1 | 2, entrada: number, alta: number): InternacaoAih => ({
    registro: 7400 + n,
    prontuario: 547_000 + n,
    atendimento: 647_000 + n,
    conta: 847_000 + n,
    contasSus: [847_000 + n],
    convenio: 1,
    entrada: dia(entrada),
    alta: dia(alta),
    motivoSaida: 12,
    carater: '2',
    especialidadeLeito: 3,
    cidPrincipal: 'I21',
    cidSecundario: null,
    paciente: {
      cns: cnsSinteticoAih(740 + n),
      cpf: null,
      sexo: n === 1 ? 'M' : 'F',
      nascimento: '1958-03-04',
      municipio: 330100,
      nome: `PACIENTE SINTETICO DA AIH ${n}`,
      raca: 99,
      cep: '25600000',
      logradouro: 'RUA SINTETICA',
      numero: '10',
      complemento: null,
    },
  });
  return {
    internacoes: [internacao(1, 2, 12), internacao(2, 20, 22)],
    itens: [
      {
        conta: 847_001,
        item: 947_011,
        tipo: 3,
        sigtap: 9012,
        quantidade: 2,
        procedimento: 7001,
        cbo: '225125',
      },
      { conta: 847_001, item: 947_012, tipo: 5, sigtap: 9013, quantidade: 1, procedimento: 7011, cbo: null },
      { conta: 847_001, item: 947_013, tipo: 3, sigtap: null, quantidade: 1, procedimento: 7012, cbo: null },
      {
        conta: 847_002,
        item: 947_021,
        tipo: 3,
        sigtap: 9012,
        quantidade: 1,
        procedimento: 7001,
        cbo: '225125',
      },
    ],
    passagens: [
      { registro: 7401, entrada: dia(2), saida: dia(4), acomodacao: 2 },
      { registro: 7401, entrada: dia(4), saida: dia(7), acomodacao: 3 },
      { registro: 7401, entrada: dia(7), saida: dia(12), acomodacao: 2 },
      { registro: 7402, entrada: dia(20), saida: dia(22), acomodacao: 1 },
    ],
  };
}

/** O intervalo da competência de hoje e da anterior (a massa existe em toda competência pedida). */
function internacaoSintetica(registro: number, hoje = new Date()): InternacaoAih | null {
  const inicio = `${hoje.toISOString().slice(0, 7)}-01`;
  return internacoesAihSinteticas(inicio).internacoes.find((x) => x.registro === registro) ?? null;
}

/** A AIH já foi apresentada nesta competência (o retorno do gestor dela, na competência, é a prova em memória). */
function reapresentadaNa(e: EstadoSusAih, aih: number, competencia: string): boolean {
  return e.retornos.some((r) => r.instrumento === 'aih' && r.aih === aih && r.competencia === competencia);
}

function erro(): never {
  throw new ErroAih('versao-alterada', 'O registro mudou desde que a tela foi aberta.');
}

export function leituraAihMemoria(b: BaseMemoriaAih): LeituraSusAih {
  const s = () => b.aih();
  return {
    internacaoAih: async (r) => internacaoSintetica(r),
    internacoesSus: async (intervalo, sus) =>
      sus.includes(1)
        ? internacoesAihSinteticas(intervalo.inicio).internacoes.map((x) => ({
            registro: x.registro,
            conta: x.conta ?? 0,
          }))
        : [],
    dadosAih: async (registros): Promise<DadosAihLidos> => {
      // A massa da competência de cada internação: a AIH guarda a alta; a sintética usa a competência de hoje e a
      // anterior (as duas existem).
      const hoje = new Date();
      const anterior = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 1, 1));
      const massas = [
        internacoesAihSinteticas(`${hoje.toISOString().slice(0, 7)}-01`),
        internacoesAihSinteticas(`${anterior.toISOString().slice(0, 7)}-01`),
      ];
      return dadosSinteticos(massas, registros);
    },
    leitosUti: async () => LEITOS_UTI_SINTETICOS.map((x) => ({ ...x })),
    lotesSaida: async (r) =>
      r === 7401 ? [{ item: 501, nome: 'STENT SINTETICO', quantidade: 1, lote: 'LOTE-SINT-1' }] : [],
    valoresSigtap: async (ids) =>
      ids.map((id) => ({
        id,
        data: '2008-01-01',
        servicoHospitalar: id === 9014 ? 478.72 : id === 9013 ? 2034.5 : 300,
        servicoProfissional: id === 9014 ? 0 : 120,
        sadt: 0,
        ambulatorial: 0,
      })),
    solicitanteAih: async (cpf) =>
      SOLICITANTES_AIH_SINTETICOS.find((x) => x.cpf === cpf.replace(/\D/g, '').padStart(11, '0')) ?? null,
    faixasAih: async () =>
      s()
        .faixas.map((f) => ({ ...f, usados: s().aihs.filter((a) => a.faixa === f.id && a.numero).length }))
        .sort((a, c) => c.inicio.localeCompare(a.inicio)),
    faixaAih: async (id) => {
      const f = s().faixas.find((x) => x.id === id);
      return f ? { ...f, usados: s().aihs.filter((a) => a.faixa === f.id && a.numero).length } : null;
    },
    maiorNumeroDaFaixa: async (id) =>
      s()
        .aihs.filter((a) => a.faixa === id && a.numero)
        .map((a) => a.numero as string)
        .sort()
        .at(-1) ?? null,
    numeroAihEmUso: async (n) => s().aihs.some((a) => a.numero === n),
    aih: async (id) => s().aihs.find((a) => a.id === id) ?? null,
    aihPorNumero: async (n) => s().aihs.find((a) => a.numero === n) ?? null,
    aihsDasInternacoes: async (r) =>
      s().aihs.filter((a) => r.includes(a.registro) && a.situacao !== 'negada' && a.situacao !== 'cancelada'),
    // A reapresentada não volta à competência em que a AIH já foi apresentada (o número é único por competência),
    // como na porta própria.
    aihsParaApresentar: async (c) =>
      s()
        .aihs.filter(
          (a) =>
            (a.situacao === 'fechada' && !reapresentadaNa(s(), a.id, c)) ||
            (a.situacao === 'apresentada' && a.competenciaApresentacao === c),
        )
        .sort((x, y) => (x.numero ?? '').localeCompare(y.numero ?? '')),
    paginaAihs: async (f) => {
      const lista = s()
        .aihs.filter(
          (a) =>
            (!f.situacao || a.situacao === f.situacao) &&
            (!f.numero || (a.numero ?? '').startsWith(f.numero)) &&
            (!f.prontuario || a.prontuario === f.prontuario) &&
            (!f.registro || a.registro === f.registro),
        )
        .sort((x, y) => y.id - x.id);
      const porSituacao: Record<string, number> = {};
      for (const a of s().aihs) porSituacao[a.situacao] = (porSituacao[a.situacao] ?? 0) + 1;
      const ini = f.pagina * f.porPagina;
      return { itens: lista.slice(ini, ini + f.porPagina), total: lista.length, porSituacao };
    },
    itensAih: async (id, fechamento) =>
      s()
        .itens.filter((x) => x.aih === id && x.fechamento === fechamento)
        .sort((x, y) => x.sequencia - y.sequencia)
        .map((x): ItemAih => ({
          sequencia: x.sequencia,
          tipo: x.tipo,
          procedimento: x.procedimento,
          sigtap: x.sigtap,
          quantidade: x.quantidade,
          cbo: x.cbo,
          item: x.item,
          tipoUti: x.tipoUti,
          opm: x.opm,
        })),
    linhaBpaDaCompetencia: async (c, p) => b.linhaBpa(c, p),
    paginaRetornos: async (f) => {
      const lista = s()
        .retornos.filter(
          (r) =>
            (!f.instrumento || r.instrumento === f.instrumento) &&
            (!f.competencia || r.competencia === f.competencia) &&
            (!f.situacao || r.situacao === f.situacao) &&
            (!f.tratamento || r.tratamento === f.tratamento),
        )
        .sort((x, y) => y.id - x.id);
      const porSituacao: Record<string, number> = {};
      for (const r of lista) porSituacao[r.situacao] = (porSituacao[r.situacao] ?? 0) + 1;
      const ini = f.pagina * f.porPagina;
      return {
        itens: lista.slice(ini, ini + f.porPagina),
        total: lista.length,
        porSituacao,
        valorGlosado: Math.round(lista.reduce((t, r) => t + r.valorGlosado, 0) * 100) / 100,
      };
    },
    retornoSus: async (id) => s().retornos.find((r) => r.id === id) ?? null,
    ultimoRetornoDaAih: async (id) =>
      s()
        .retornos.filter((r) => r.aih === id)
        .sort((x, y) => y.id - x.id)[0] ?? null,
  };
}

function dadosSinteticos(
  massas: readonly ReturnType<typeof internacoesAihSinteticas>[],
  registros: readonly number[],
): DadosAihLidos {
  const internacoes: InternacaoAih[] = [];
  const itens: ItemContaAih[] = [];
  const passagens: PassagemLeito[] = [];
  const vistos = new Set<number>();
  for (const m of massas)
    for (const i of m.internacoes) {
      if (!registros.includes(i.registro) || vistos.has(i.registro)) continue;
      vistos.add(i.registro);
      internacoes.push(i);
      itens.push(...m.itens.filter((x) => x.conta === i.conta));
      passagens.push(...m.passagens.filter((x) => x.registro === i.registro));
    }
  const atributos = {
    idadeMinima: 0,
    idadeMaxima: 9999,
    sexo: null,
    quantidadeMaxima: null,
    complexidade: 'MC',
  };
  return {
    internacoes,
    itens,
    passagens,
    procedimentos: SIGTAP_AIH_SINTETICO.map((p) => ({
      id: p.id,
      codigo: p.codigo,
      competenciaInicial: 200801,
      competenciaFinal: 0,
      ...atributos,
      permanencia: p.permanencia,
    })),
    historico: [],
    registros: SIGTAP_AIH_SINTETICO.map((p) => ({
      id: p.id,
      registro: p.registro,
      competenciaInicial: 200801,
      competenciaFinal: 0,
    })),
    compatibilidades: {
      cids: [{ id: 9003, codigo: 'I21', competenciaInicial: 200801, competenciaFinal: 0 }],
      cbos: [],
      habilitacoes: [],
      leitos: [],
    },
    porCodigo: SIGTAP_AIH_SINTETICO.map((p) => ({ id: p.id, codigo: p.codigo, nome: p.nome })),
    cids: new Set(['I21', 'I10', 'J18']),
    leitosUti: LEITOS_UTI_SINTETICOS.map((x) => ({ ...x })),
    cnesCadastrados: [9_999_991],
  };
}

export function gravacaoAihMemoria(b: BaseMemoriaAih): GravacaoSusAih {
  const s = () => b.aih();
  const mudar = (
    a: { id: number; versao: number },
    de: readonly AihRegistro['situacao'][],
    m: Partial<AihRegistro>,
    por: string,
  ) => {
    const x = s().aihs.find((y) => y.id === a.id);
    if (!x || x.versao !== a.versao || !de.includes(x.situacao)) erro();
    if (m.numero && s().aihs.some((y) => y.id !== a.id && y.numero === m.numero))
      throw new ErroAih('numero-em-uso', 'Este número de AIH já foi usado.');
    s().aihs = s().aihs.map((y) =>
      y.id === a.id ? { ...y, ...m, alteradaPor: por, alteradaEm: agora(), versao: y.versao + 1 } : y,
    );
  };
  return {
    inserirFaixaAih: async (p) => {
      const inicio = p.inicio.toString().padStart(12, '0');
      if (s().faixas.some((f) => f.inicio === inicio))
        throw new ErroAih('faixa-sobreposta', 'Já existe uma faixa que começa neste número.');
      const id = b.proximo();
      s().faixas.push({
        id,
        inicio,
        fim: p.fim.toString().padStart(12, '0'),
        orgaoEmissor: p.orgaoEmissor,
        dataLiberacao: p.dataLiberacao,
        situacao: 'ativa',
        justificativa: null,
        usados: 0,
        registradaPor: p.por,
        registradaEm: agora(),
        versao: 1,
      });
      return id;
    },
    mudarFaixaAih: async (p) => {
      const f = s().faixas.find((x) => x.id === p.id);
      if (!f || f.versao !== p.versao || f.situacao !== 'ativa') erro();
      s().faixas = s().faixas.map((x) =>
        x.id === p.id
          ? {
              ...x,
              situacao: p.situacao,
              justificativa: p.justificativa ?? x.justificativa,
              versao: x.versao + 1,
            }
          : x,
      );
    },
    inserirAih: async (p) => {
      const id = b.proximo();
      s().aihs.push({
        id,
        situacao: 'solicitada',
        registro: p.registro,
        prontuario: p.prontuario,
        conta: p.conta,
        atendimento: p.atendimento,
        procedimentoSolicitado: p.procedimentoSolicitado,
        procedimentoRealizado: null,
        cidPrincipal: p.cidPrincipal,
        cidSecundario: p.cidSecundario,
        carater: p.carater,
        solicitante: p.solicitante,
        dataLaudo: p.dataLaudo,
        justificativa: p.justificativa,
        faixa: null,
        numero: null,
        cnsAutorizador: null,
        dataAutorizacao: null,
        fechamento: 0,
        permanencia: null,
        diariasUti: null,
        diariasUtiAnterior: null,
        competenciaApresentacao: null,
        arquivo: null,
        reapresentacoes: 0,
        justificativaSituacao: null,
        registradaPor: p.por,
        registradaEm: agora(),
        alteradaPor: null,
        alteradaEm: null,
        versao: 1,
      });
      return id;
    },
    autorizarAih: async (a, p) =>
      mudar(
        a,
        ['solicitada'],
        {
          situacao: 'autorizada',
          faixa: p.faixa,
          numero: p.numero,
          cnsAutorizador: p.autorizador,
          dataAutorizacao: p.dataAutorizacao,
        },
        p.por,
      ),
    negarAih: async (a, j, por) =>
      mudar(a, ['solicitada'], { situacao: 'negada', justificativaSituacao: j }, por),
    reabrirAih: async (a, j, por) =>
      mudar(a, ['fechada'], { situacao: 'autorizada', justificativaSituacao: j }, por),
    cancelarAih: async (a, j, por) =>
      mudar(
        a,
        ['solicitada', 'autorizada', 'fechada'],
        { situacao: 'cancelada', justificativaSituacao: j },
        por,
      ),
    fecharAih: async (a, p) => {
      const fechamento = a.fechamento + 1;
      mudar(
        a,
        ['autorizada'],
        {
          situacao: 'fechada',
          procedimentoRealizado: p.procedimentoRealizado,
          fechamento,
          permanencia: p.permanencia,
          diariasUti: p.diariasUti,
          diariasUtiAnterior: p.diariasUtiAnterior,
          justificativaSituacao: null,
        },
        p.por,
      );
      p.itens.forEach((x, k) => s().itens.push({ ...x, sequencia: k + 1, aih: a.id, fechamento }));
    },
    gravarArquivoSisaih: async (arq, aihs) => {
      const r = await b.inserirArquivo(arq);
      for (const x of aihs) {
        const a = s().aihs.find((y) => y.id === x.id);
        if (!a || a.versao !== x.versao || (a.situacao !== 'fechada' && a.situacao !== 'apresentada')) erro();
        if (a.situacao === 'fechada' && reapresentadaNa(s(), a.id, arq.competencia.competencia))
          throw recusa(
            'aih-reapresentada-mesma-competencia',
            `A AIH reapresentada já foi apresentada na competência ${arq.competencia.competencia}: reapresente-a ` +
              'numa competência seguinte. Nada foi gravado.',
          );
        s().aihs = s().aihs.map((y) =>
          y.id === x.id
            ? {
                ...y,
                situacao: 'apresentada',
                competenciaApresentacao: arq.competencia.competencia,
                arquivo: arq.id,
                versao: y.versao + 1,
              }
            : y,
        );
      }
      return r;
    },
    inserirRetornoSus: async (r) => {
      if (
        s().retornos.some(
          (x) =>
            x.instrumento === r.instrumento &&
            x.competencia === r.competencia &&
            x.identificacao === r.identificacao &&
            x.hashRetorno === r.hashRetorno,
        )
      )
        return null;
      const id = b.proximo();
      s().retornos.push({
        id,
        instrumento: r.instrumento,
        competencia: r.competencia,
        identificacao: r.identificacao,
        procedimento: r.procedimento,
        aih: r.aih,
        linhaBpa: r.linhaBpa,
        arquivo: r.arquivo,
        situacao: r.situacao,
        motivo: r.motivo,
        valorApresentado: r.valorApresentado,
        valorAprovado: r.valorAprovado,
        valorGlosado: r.valorGlosado,
        arquivoRetorno: r.arquivoRetorno,
        hashRetorno: r.hashRetorno,
        tratamento: r.situacao === 'aprovada' ? 'aceita' : 'pendente',
        justificativa: null,
        importadoPor: r.por,
        importadoEm: agora(),
        tratadoPor: null,
        tratadoEm: null,
        versao: 1,
      });
      return id;
    },
    aplicarRetornoNaAih: async (id, situacao, por) => {
      const a = s().aihs.find((x) => x.id === id);
      if (!a || !['apresentada', 'aprovada', 'rejeitada'].includes(a.situacao)) return false;
      s().aihs = s().aihs.map((x) =>
        x.id === id ? { ...x, situacao, alteradaPor: por, alteradaEm: agora(), versao: x.versao + 1 } : x,
      );
      return true;
    },
    tratarRetornoSus: async (r, p) => {
      const x = s().retornos.find((y) => y.id === r.id);
      if (!x || x.versao !== r.versao || x.tratamento !== 'pendente') erro();
      s().retornos = s().retornos.map((y) =>
        y.id === r.id
          ? {
              ...y,
              tratamento: p.decisao,
              justificativa: p.justificativa,
              tratadoPor: p.por,
              tratadoEm: agora(),
              versao: y.versao + 1,
            }
          : y,
      );
      if (p.decisao === 'reapresentar' && p.aih !== null) {
        const a = s().aihs.find((y) => y.id === p.aih);
        if (!a || a.situacao !== 'rejeitada')
          throw new ErroAih('versao-alterada', 'A AIH não está rejeitada: nada foi reapresentado.');
        s().aihs = s().aihs.map((y) =>
          y.id === p.aih
            ? {
                ...y,
                situacao: 'fechada',
                reapresentacoes: y.reapresentacoes + 1,
                competenciaApresentacao: null,
                arquivo: null,
                versao: y.versao + 1,
              }
            : y,
        );
      }
    },
  };
}
