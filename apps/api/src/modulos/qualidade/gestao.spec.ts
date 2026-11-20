// API da gestão da qualidade e dos envios regulatórios (M48, etapa 5) sobre a porta em memória (dados SINTÉTICOS): a
// gestão documental com revisão e ciência, os indicadores da competência com a análise crítica, a auditoria por checklist,
// a comissão e a reunião, o risco GUT, a não conformidade, a ouvidoria com o NPS e os envios com o resumo SHA-256; a
// chave de liberação, as permissões e a trilha sem relato, manifestante nem conteúdo.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import {
  chavesIniciaisSinteticas,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/configuracao-fonte.js';
import { PortaCcihMemoria } from './porta-ccih-memoria.js';
import { GESTAO_SINTETICA, PortaGestaoMemoria } from './porta-gestao-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
/** 2026-10-27 12:00 em São Paulo. */
const agora = () => new Date('2026-10-27T15:00:00Z');

interface Sessao {
  cookie: string;
  csrf: string;
}

/** A CCIH em memória com uma competência de setembro: 300 pacientes-dia, 10 CVC-dia, 1 IPCS e 4 oportunidades. */
function ccihDeSetembro(): PortaCcihMemoria {
  const p = new PortaCcihMemoria();
  return Object.assign(p, {
    censo: async () => ({ porSetor: [{ setor: 'UTI SINT', pacientesDia: 300 }], diasFechados: 30 }),
    dispositivosNoPeriodo: async () => ({
      itens: [
        {
          id: 1,
          reg: 948_501,
          paciente: null,
          setor: 'UTI SINT',
          acomodacao: null,
          leito: null,
          tipo: 'cvc',
          sitio: null,
          inseridoEm: '2026-09-01T08:00:00',
          itemPrescricao: null,
          observacao: null,
          retiradoEm: '2026-09-11T08:00:00',
          motivoRetirada: null,
          registradoPor: 'SINT.CCIH',
          versao: 1,
        },
        // W0-04 (M2): a extubação não planejada (retirada acidental do tubo) da competência.
        {
          id: 4,
          reg: 948_502,
          paciente: null,
          setor: 'UTI SINT',
          acomodacao: null,
          leito: null,
          tipo: 'ventilacaoMecanica',
          sitio: null,
          inseridoEm: '2026-09-18T08:00:00',
          itemPrescricao: null,
          observacao: null,
          retiradoEm: '2026-09-20T03:00:00',
          motivoRetirada: 'acidental',
          registradoPor: 'SINT.CCIH',
          versao: 1,
        },
      ],
      cortada: false,
    }),
    irasNoPeriodo: async () => ({
      itens: [
        {
          id: 2,
          reg: 948_501,
          paciente: null,
          setor: 'UTI SINT',
          sitio: 'ipcs',
          dataInfeccao: '2026-09-08',
          criterios: [],
          nivelIsc: null,
          cirurgia: null,
          implante: false,
          exame: null,
          microrganismo: null,
          multirresistente: false,
          dispositivo: 1,
          descricao: null,
          situacao: 'confirmada',
          motivoDescarte: null,
          registradoPor: 'SINT.CCIH',
          registradoEm: '2026-09-09T10:00:00',
          versao: 1,
        },
      ],
      cortada: false,
    }),
    observacoesMaos: async () => ({
      itens: [
        {
          id: 3,
          unidade: 1,
          setor: 'UTI SINT',
          observadoEm: '2026-09-10T10:00:00',
          categoria: 'enfermagem',
          oportunidades: 4,
          conformes: 3,
          detalhe: [
            { momento: 'antesContato', acao: 'friccao', luvas: false },
            { momento: 'antesAsseptico', acao: 'lavagem', luvas: false },
            { momento: 'aposFluidos', acao: 'friccao', luvas: false },
            { momento: 'aposContato', acao: 'omitida', luvas: false },
          ],
          registradoPor: 'SINT.CCIH',
        },
      ],
      cortada: false,
    }),
    altasDas: async () => [],
  });
}

async function montar(o: { semChave?: boolean } = {}) {
  const trilha = new RegistradorTrilhaMemoria();
  const configuracao = o.semChave
    ? fonteConfiguracaoMemoria(trilha, {
        chavesIniciais: () => chavesIniciaisSinteticas().filter((c) => c.chave !== 'qualidade.gestao'),
        prerequisitosIniciais: prerequisitosIniciaisSinteticos,
        parametrosIniciais: parametrosIniciaisSinteticos,
      })
    : undefined;
  const porta = new PortaGestaoMemoria({ agora });
  const app: NestFastifyApplication = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    gestao: porta,
    ccih: ccihDeSetembro(),
    vigiaEnfermagem: null,
    vigia: null,
    ...(configuracao ? { configuracao } : {}),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return {
    app,
    trilha,
    porta,
    async entrar(login: string): Promise<Sessao> {
      const r = await app.inject({
        method: 'POST',
        url: '/api/sessao',
        payload: { estabelecimento: 'aa', login, senha: SENHA },
      });
      expect(r.statusCode, r.body).toBe(201);
      const set = r.headers['set-cookie'] as string[];
      return {
        cookie: set.map((c) => c.split(';')[0]).join('; '),
        csrf:
          set
            .find((c) => c.startsWith('sgh_csrf='))
            ?.split(';')[0]
            ?.slice(9) ?? '',
      };
    },
    get: (s: Sessao, url: string) =>
      app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } }),
    post: (s: Sessao, url: string, payload: unknown = {}) =>
      app.inject({
        method: 'POST',
        url: `/api${url}`,
        headers: { cookie: s.cookie, 'x-csrf': s.csrf },
        payload: payload as object,
      }),
  };
}

type App = Awaited<ReturnType<typeof montar>>;
let a: App;
let qu: Sessao;
let ou: Sessao;
let vi: Sessao;
let nsp: Sessao;
let cc: Sessao;
beforeAll(async () => {
  a = await montar();
  qu = await a.entrar('SINT.QUALIDADE');
  ou = await a.entrar('SINT.OUVIDORIA');
  vi = await a.entrar('SINT.VIGILANCIA');
  nsp = await a.entrar('SINT.NSP');
  cc = await a.entrar('SINT.CCIH');
});
afterAll(async () => {
  await a.app.close();
});

const json = <T = Record<string, unknown>>(r: { body: string }) => JSON.parse(r.body) as T;
const codigo = (r: { body: string }) => json<{ codigo?: string }>(r).codigo;
const pop = {
  codigo: 'pop-enf-001',
  tipo: 'pop',
  titulo: 'Identificação do paciente',
  area: 'Enfermagem',
  conteudo: 'Conferir dois identificadores antes de todo procedimento (sintético).',
  resumoAlteracao: null,
  elaboradoPor: 'SINT.ENFERMEIRA',
  revisadoPor: null,
  vigenciaAte: '2028-10-27',
  exigeCiencia: true,
  substitui: null,
};

describe('gestão documental', () => {
  it('publica, recusa o aprovador elaborador e o código vigente, revisa e torna a anterior obsoleta', async () => {
    const r1 = await a.post(qu, '/qualidade/documentos', pop);
    expect(r1.statusCode, r1.body).toBe(201);
    const d1 = json<{ id: number; revisao: number; hash: string }>(r1);
    expect(d1).toMatchObject({ revisao: 1 });
    expect(d1.hash).toMatch(/^[0-9a-f]{64}$/);
    const proprio = await a.post(qu, '/qualidade/documentos', {
      ...pop,
      codigo: 'POP-ENF-002',
      elaboradoPor: 'sint.qualidade',
    });
    expect([proprio.statusCode, codigo(proprio)]).toEqual([422, 'aprovador-e-elaborador']);
    const dup = await a.post(qu, '/qualidade/documentos', pop);
    expect([dup.statusCode, codigo(dup)]).toEqual([409, 'codigo-ja-vigente']);
    const r2 = await a.post(qu, '/qualidade/documentos', {
      ...pop,
      conteudo: `${pop.conteudo} Revisado.`,
      resumoAlteracao: 'Inclui o recém-nascido.',
      substitui: { id: d1.id, versao: 1 },
    });
    expect(r2.statusCode, r2.body).toBe(201);
    expect(json(r2)).toMatchObject({ revisao: 2 });
    const velha = await a.post(qu, '/qualidade/documentos', { ...pop, substitui: { id: d1.id, versao: 1 } });
    expect([velha.statusCode, codigo(velha)]).toEqual([409, 'substituta-nao-vigente']);
    const todos = json<{ itens: { revisao: number; situacao: string }[] }>(
      await a.get(qu, '/qualidade/documentos'),
    );
    expect(todos.itens.map((d) => [d.revisao, d.situacao])).toEqual([
      [2, 'vigente'],
      [1, 'obsoleto'],
    ]);
  });

  it('todo perfil de pessoa lê os vigentes e dá ciência uma vez; o obsoleto não aparece para ele', async () => {
    const lista = json<{ itens: { id: number; situacao: string; cienteSessao: boolean }[] }>(
      await a.get(vi, '/qualidade/documentos?situacao=obsoleto'),
    );
    expect(lista.itens.map((d) => d.situacao)).toEqual(['vigente']);
    const id = lista.itens[0]!.id;
    const det = json<{ conteudo: string; revisoes: unknown[] }>(
      await a.get(vi, `/qualidade/documentos/${id}`),
    );
    expect(det.conteudo).toContain('Revisado');
    expect(det.revisoes).toEqual([]);
    const antes = json<{ cienciasPendentesSessao: number }>(await a.get(vi, '/qualidade/gestao/resumo'));
    expect(antes.cienciasPendentesSessao).toBe(1);
    expect((await a.post(vi, `/qualidade/documentos/${id}/ciencia`)).statusCode).toBe(201);
    const de_novo = await a.post(vi, `/qualidade/documentos/${id}/ciencia`);
    expect([de_novo.statusCode, codigo(de_novo)]).toEqual([409, 'ciencia-ja-registrada']);
    const depois = json<{ cienciasPendentesSessao: number; riscosCriticos: number }>(
      await a.get(vi, '/qualidade/gestao/resumo'),
    );
    expect(depois.cienciasPendentesSessao).toBe(0);
    const cientes = json<{ itens: { usuario: string }[] }>(
      await a.get(qu, `/qualidade/documentos/${id}/ciencias`),
    );
    expect(cientes.itens.map((c) => c.usuario)).toEqual(['SINT.VIGILANCIA']);
    expect((await a.get(vi, `/qualidade/documentos/${id}/ciencias`)).statusCode).toBe(403);
    expect((await a.post(vi, '/qualidade/documentos', { ...pop, codigo: 'X-1' })).statusCode).toBe(403);
  });

  it('retira com o motivo e a versão; a trilha não leva o conteúdo', async () => {
    const lista = json<{ itens: { id: number; versao: number }[] }>(
      await a.get(qu, '/qualidade/documentos?situacao=vigente'),
    );
    const d = lista.itens[0]!;
    const velha = await a.post(qu, `/qualidade/documentos/${d.id}/retirada`, {
      versao: d.versao + 1,
      motivo: 'Substituído pelo protocolo da rede.',
    });
    expect([velha.statusCode, codigo(velha)]).toEqual([409, 'versao-desatualizada']);
    const r = await a.post(qu, `/qualidade/documentos/${d.id}/retirada`, {
      versao: d.versao,
      motivo: 'Substituído pelo protocolo da rede.',
    });
    expect(r.statusCode, r.body).toBe(201);
    const linhas = JSON.stringify(a.trilha.eventos.filter((l) => l.evento.startsWith('qualidade.documento')));
    expect(linhas).not.toContain('identificadores');
    expect(linhas).toContain('qualidade.documento.publicado');
    expect(linhas).toContain('qualidade.documento.retirado');
  });
});

describe('W0-04 (M2 e M3): segurança do paciente e linhas de cuidado no catálogo', () => {
  type Ind = {
    ficha: { codigo: string; origem: string; unidade: string; denominador: string | null };
    numerador: number | null;
    denominador: number | null;
    valor: number | null;
    conta: string | null;
    meta: number | null;
    situacaoMeta: string;
    pendente: boolean;
  };
  const conteudoSepse = {
    tipo: 'sepse' as const,
    nome: 'Sepse SINTETICO',
    criterios: [{ codigo: 'sirs', titulo: 'Dois ou mais critérios' }],
    metas: [{ codigo: 'antibiotico', titulo: 'Antibiótico', prazoMin: 60, desde: 'inclusao' as const }],
    checklist: [],
  };
  const incl = (id: number, minutos: number | null, descartado = false) => ({
    id,
    cabecalho: String(id),
    reg: id,
    paciente: 1,
    tipo: 'sepse',
    gerenciado: 77,
    origem: 'enfermeiro' as const,
    sugeridoPor: null,
    criterios: ['sirs'],
    chegadaEm: '2026-09-15T07:40:00',
    incluidoEm: '2026-09-15T08:00:00',
    incluidoPor: 'SINT.ENF',
    eventos: [
      ...(minutos === null
        ? []
        : [
            {
              id: id * 10,
              tipo: 'meta' as const,
              codigo: 'antibiotico',
              situacao: 'cumprida',
              quando: `2026-09-15T${String(8 + Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}:00`,
              prazoEm: '2026-09-15T09:00:00',
              motivo: null,
              por: 'SINT.ENF',
              em: '2026-09-15T10:00:00',
            },
          ]),
      ...(descartado
        ? [
            {
              id: id * 10 + 1,
              tipo: 'encerramento' as const,
              codigo: 'encerramento',
              situacao: 'descartado',
              quando: null,
              prazoEm: null,
              motivo: 'Critério não confirmado (sintético).',
              por: 'SINT.ENF',
              em: '2026-09-15T10:00:00',
            },
          ]
        : []),
    ],
  });

  beforeAll(async () => {
    const { createHash } = await import('node:crypto');
    const { conteudoCanonico } = await import('@sgh/dominio-recepcao');
    a.porta.notificacoesSint = [
      { ocorridoEm: '2026-09-05T10:00:00', tipo: 'queda', classificacao: 'incidenteSemDano' },
      { ocorridoEm: '2026-09-06T10:00:00', tipo: 'queda', classificacao: 'quaseErro' },
      { ocorridoEm: '2026-09-07T10:00:00', tipo: 'lesaoPressao', classificacao: 'eventoAdverso' },
      { ocorridoEm: '2026-09-08T10:00:00', tipo: 'medicacao', classificacao: 'quaseErro' },
      { ocorridoEm: '2026-09-09T10:00:00', tipo: 'flebite', classificacao: 'incidenteSemDano' },
      { ocorridoEm: '2026-08-09T10:00:00', tipo: 'flebite', classificacao: 'incidenteSemDano' },
    ];
    a.porta.protocolosSint = {
      versoes: [
        {
          id: 77,
          tipo: 'sepse',
          versao: 1,
          nome: 'Sepse SINTETICO',
          notas: 'Sintético.',
          autor: 'SINT.AUTOR',
          aprovador: 'SINT.DIRETOR',
          publicadoEm: '2026-01-01T00:00:00',
          impressao: createHash('sha256')
            .update(conteudoCanonico(conteudoSepse as never))
            .digest('hex'),
          conteudo: conteudoSepse,
        },
      ],
      // 40, 55 e 90 minutos da inclusão (dois no alvo de 60), uma sem registro e uma descartada
      protocolos: [incl(1, 40), incl(2, 55), incl(3, 90), incl(4, null), incl(5, 10, true)],
    };
  });

  it('M2: as cinco taxas por 1.000 pacientes-dia do censo, com as parcelas, a meta do catálogo e a análise', async () => {
    const r = await a.get(qu, '/qualidade/indicadores?competencia=2026-09');
    expect(r.statusCode, r.body).toBe(200);
    const itens = json<{ itens: Ind[] }>(r).itens;
    const de = (c: string) => itens.find((i) => i.ficha.codigo === c)!;
    // queda: 1 sintética (evento adverso) + 1 incidente sem dano; o quase erro não conta
    expect(de('taxaQueda')).toMatchObject({
      numerador: 2,
      denominador: 300,
      valor: 6.67,
      conta: '2 ÷ 300 × 1.000 = 6,67',
      situacaoMeta: 'sem-meta',
      pendente: true,
    });
    expect(de('taxaQueda').ficha).toMatchObject({ origem: 'seguranca', unidade: 'densidade' });
    expect(de('incidenciaLpp')).toMatchObject({ numerador: 1, denominador: 300 });
    // medicação: o evento adverso sintético e o quase erro
    expect(de('taxaErroMedicacao')).toMatchObject({ numerador: 2, denominador: 300 });
    // flebite: só a de setembro
    expect(de('taxaFlebite')).toMatchObject({
      numerador: 1,
      denominador: 300,
      conta: '1 ÷ 300 × 1.000 = 3,33',
    });
    expect(de('taxaExtubacaoNaoPlanejada')).toMatchObject({ numerador: 1, denominador: 300 });
    // a análise crítica do indicador novo pelo mesmo caminho (competência fechada)
    const an = await a.post(qu, '/qualidade/indicadores/taxaQueda/analise', {
      analise: null,
      versao: null,
      competencia: '2026-09',
      texto: 'Duas quedas no mês, ambas no banheiro (sintético).',
      causas: null,
      plano: null,
      responsavel: null,
      prazo: null,
    });
    expect(an.statusCode, an.body).toBe(201);
    const depois = json<{ itens: Ind[] }>(await a.get(qu, '/qualidade/indicadores?competencia=2026-09'));
    expect(depois.itens.find((i) => i.ficha.codigo === 'taxaQueda')?.pendente).toBe(false);
  });

  it('M3: sepse com o % no alvo e a mediana da meta-chave, com os tempos impressos; AVC sem inclusão fica sem valor', async () => {
    const itens = json<{ itens: Ind[] }>(await a.get(qu, '/qualidade/indicadores?competencia=2026-09')).itens;
    const de = (c: string) => itens.find((i) => i.ficha.codigo === c)!;
    expect(de('sepseNoAlvo')).toMatchObject({
      numerador: 2,
      denominador: 4,
      valor: 50,
      conta: '2 ÷ 4 × 100 = 50',
    });
    expect(de('sepseMediana')).toMatchObject({
      numerador: 55,
      denominador: null,
      valor: 55,
      conta: 'mediana de 3 tempos (40, 55 e 90 min) = 55 min',
    });
    expect(de('sepseMediana').ficha).toMatchObject({
      origem: 'linhaCuidado',
      unidade: 'minutos',
      denominador: null,
    });
    expect(de('avcNoAlvo')).toMatchObject({ valor: null, situacaoMeta: 'sem-valor', pendente: false });
  });

  it('a série mensal com as parcelas e a planilha (CSV) da competência; sem permissão, 403', async () => {
    const r = await a.get(qu, '/qualidade/indicadores/taxaFlebite/serie?ate=2026-09&meses=3');
    expect(r.statusCode, r.body).toBe(200);
    const serie = json<{
      itens: { competencia: string; numerador: number | null; denominador: number | null }[];
    }>(r);
    expect(serie.itens.map((p) => [p.competencia, p.numerador, p.denominador])).toEqual([
      ['2026-07', 0, 300],
      ['2026-08', 1, 300],
      ['2026-09', 1, 300],
    ]);
    expect((await a.get(qu, '/qualidade/indicadores/inexistente/serie?ate=2026-09')).statusCode).toBe(404);
    expect((await a.get(qu, '/qualidade/indicadores/taxaQueda/serie?ate=2026-09&meses=13')).statusCode).toBe(
      400,
    );
    const csv = await a.get(qu, '/qualidade/indicadores/exportacao?competencia=2026-09');
    expect(csv.statusCode, csv.body).toBe(200);
    expect(csv.headers['content-type']).toMatch(/^text\/csv/);
    const linhas = csv.body.split('\r\n');
    expect(linhas[0]).toMatch(/^codigo;indicador;origem;competencia;numerador;denominador;fator;valor/);
    expect(linhas.find((l) => l.startsWith('taxaQueda;'))).toContain(
      ';seguranca;2026-09;2;300;1000;6,67;densidade;',
    );
    expect(linhas.find((l) => l.startsWith('sepseMediana;'))).toContain(
      'mediana de 3 tempos (40, 55 e 90 min) = 55 min',
    );
    expect((await a.get(vi, '/qualidade/indicadores/exportacao?competencia=2026-09')).statusCode).toBe(403);
  });

  it('a meta sai do catálogo (qualidade.meta.taxaQueda) e a meta-chave da linha é parâmetro', async () => {
    const { definicaoParametro } = await import('@sgh/contratos');
    for (const c of [
      'taxaQueda',
      'incidenciaLpp',
      'taxaErroMedicacao',
      'taxaFlebite',
      'taxaExtubacaoNaoPlanejada',
      'sepseMediana',
    ])
      expect(definicaoParametro(`qualidade.meta.${c}`)?.padrao, c).toBe('sem meta');
    expect(definicaoParametro('qualidade.linhaCuidado.metaChave.sepse')?.padrao).toBe('antibiotico');
  });
});

describe('indicadores', () => {
  it('a competência com as fichas, as parcelas da CCIH e a análise crítica (fora da meta exige o plano)', async () => {
    const r = await a.get(qu, '/qualidade/indicadores?competencia=2026-09');
    expect(r.statusCode, r.body).toBe(200);
    const b = json<{
      itens: {
        ficha: { codigo: string; origem?: string };
        numerador: number | null;
        denominador: number | null;
        valor: number | null;
        conta: string | null;
        situacaoMeta: string;
        pendente: boolean;
      }[];
      podeAnalisar: boolean;
    }>(r);
    const ipcs = b.itens.find((i) => i.ficha.codigo === 'densidadeIpcsCvc')!;
    expect(ipcs).toMatchObject({
      numerador: 1,
      denominador: 10,
      valor: 100,
      conta: '1 ÷ 10 × 1.000 = 100',
      situacaoMeta: 'sem-meta',
      pendente: true,
    });
    const maos = b.itens.find((i) => i.ficha.codigo === 'adesaoHigieneMaos')!;
    expect(maos).toMatchObject({ numerador: 3, denominador: 4, valor: 75 });
    // W0-07 (M3): as fichas de higienização e giro de leito estão no catálogo, com a origem própria.
    for (const codigo of ['tempoGiroLeito', 'higienizacaoNoPrazo', 'tempoExecucaoLimpeza'])
      expect(b.itens.find((i) => i.ficha.codigo === codigo)?.ficha, codigo).toMatchObject({
        origem: 'higienizacao',
      });
    // W0-07 (critério 6): o retorno ao PA em 72 h e a internação via PA estão no catálogo, com numerador e
    // denominador vindos das fichas do PA (a porta do atendimento em memória).
    for (const codigo of ['retornoPa72h', 'internacaoViaPa']) {
      const i = b.itens.find((x) => x.ficha.codigo === codigo);
      expect(i?.ficha, codigo).toMatchObject({ origem: 'atendimento' });
      expect(typeof i?.numerador, codigo).toBe('number');
      expect(typeof i?.denominador, codigo).toBe('number');
    }
    expect(b.podeAnalisar).toBe(true);
    const base = {
      analise: null,
      versao: null,
      competencia: '2026-09',
      texto: 'Um caso no mês com poucos dispositivos-dia (sintético).',
      causas: null,
      plano: null,
      responsavel: null,
      prazo: null,
    };
    const aberta = await a.post(qu, '/qualidade/indicadores/densidadeIpcsCvc/analise', {
      ...base,
      competencia: '2026-10',
    });
    expect([aberta.statusCode, codigo(aberta)]).toEqual([422, 'competencia-aberta']);
    const fora = await a.post(qu, '/qualidade/indicadores/inexistente/analise', base);
    expect([fora.statusCode, codigo(fora)]).toEqual([422, 'indicador-inexistente']);
    const ok = await a.post(qu, '/qualidade/indicadores/densidadeIpcsCvc/analise', base);
    expect(ok.statusCode, ok.body).toBe(201);
    const dup = await a.post(qu, '/qualidade/indicadores/densidadeIpcsCvc/analise', base);
    expect([dup.statusCode, codigo(dup)]).toEqual([409, 'analise-ja-registrada']);
    const depois = json<{
      itens: {
        ficha: { codigo: string };
        analise: { texto: string; valor: number } | null;
        pendente: boolean;
      }[];
    }>(await a.get(qu, '/qualidade/indicadores?competencia=2026-09'));
    const d = depois.itens.find((i) => i.ficha.codigo === 'densidadeIpcsCvc')!;
    expect(d.analise).toMatchObject({ valor: 100 });
    expect(d.pendente).toBe(false);
    const hist = json<{ itens: unknown[] }>(
      await a.get(qu, '/qualidade/indicadores/densidadeIpcsCvc/analises'),
    );
    expect(hist.itens).toHaveLength(1);
    // O censo do M16 entra com a ficha convertida (o PM-QUALISS marcado nos do conjunto).
    expect(b.itens.find((i) => i.ficha.codigo === 'taxaOcupacao')).toBeTruthy();
    expect((await a.get(vi, '/qualidade/indicadores?competencia=2026-09')).statusCode).toBe(403);
  });
});

describe('auditoria, comissão, risco e não conformidade', () => {
  it('auditoria com o checklist e a conformidade; o achado sem evidência recusado; a NC da auditoria contada', async () => {
    const aud = {
      titulo: 'Auditoria de identificação do paciente',
      area: 'UTI',
      referencial: 'interno',
      realizadaEm: '2026-10-20',
      auditores: 'Equipe da qualidade (sintético)',
      itens: [
        { requisito: 'Pulseira no paciente', secao: 'Meta 1', resultado: 'conforme', evidencia: null },
        {
          requisito: 'Dupla checagem na medicação',
          secao: 'Meta 1',
          resultado: 'naoConforme',
          evidencia: null,
        },
      ],
      conclusao: 'Necessita reforço na dupla checagem.',
    };
    const sem = await a.post(qu, '/qualidade/gestao/auditorias', aud);
    expect([sem.statusCode, codigo(sem)]).toEqual([422, 'item-nao-conforme-sem-evidencia']);
    aud.itens[1]!.evidencia = '2 de 10 sem dupla checagem' as never;
    const r = await a.post(qu, '/qualidade/gestao/auditorias', aud);
    expect(r.statusCode, r.body).toBe(201);
    const { id, resultado } = json<{ id: number; resultado: { conformidade: number; conta: string } }>(r);
    expect(resultado).toMatchObject({ conformidade: 50, conta: '(1 + 0,5 × 0) ÷ 2 × 100 = 50%' });
    const nc = {
      naoConformidade: null,
      versao: null,
      origem: 'auditoria',
      idOrigem: id,
      descricao: 'Dupla checagem não realizada na UTI.',
      area: 'UTI',
      classificacao: 'maior',
      acaoImediata: null,
      causa: null,
      plano: null,
      responsavel: null,
      prazo: null,
      situacao: 'aberta',
      eficacia: null,
      eficaciaTexto: null,
    };
    const semOrigem = await a.post(qu, '/qualidade/gestao/nao-conformidades', { ...nc, idOrigem: 999 });
    expect([semOrigem.statusCode, codigo(semOrigem)]).toEqual([422, 'origem-sem-registro']);
    // A notificação de incidente do NSP é conferida pela existência (sem ler o relato nem o notificador).
    const semNotif = await a.post(qu, '/qualidade/gestao/nao-conformidades', {
      ...nc,
      origem: 'notificacao',
      idOrigem: 999,
    });
    expect([semNotif.statusCode, codigo(semNotif)]).toEqual([422, 'origem-sem-registro']);
    const indicador = await a.post(qu, '/qualidade/gestao/nao-conformidades', {
      ...nc,
      origem: 'indicador',
      idOrigem: 7,
    });
    expect([indicador.statusCode, codigo(indicador)]).toEqual([422, 'origem-sem-registro']);
    const daNotif = await a.post(qu, '/qualidade/gestao/nao-conformidades', {
      ...nc,
      origem: 'notificacao',
      idOrigem: GESTAO_SINTETICA.notificacoes[0],
      descricao: 'Queda sem avaliação de risco registrada (sintético).',
    });
    expect(daNotif.statusCode, daNotif.body).toBe(201);
    const n1 = await a.post(qu, '/qualidade/gestao/nao-conformidades', nc);
    expect(n1.statusCode, n1.body).toBe(201);
    const ncId = json<{ id: number }>(n1).id;
    const trat = {
      ...nc,
      naoConformidade: ncId,
      versao: 1,
      situacao: 'emTratamento',
      causa: 'Equipe nova sem treinamento.',
      plano: 'Treinar a equipe e auditar em 30 dias.',
      responsavel: 'Coordenação de enfermagem',
      prazo: '2026-11-26',
    };
    expect((await a.post(qu, '/qualidade/gestao/nao-conformidades', trat)).statusCode).toBe(201);
    const pulo = await a.post(qu, '/qualidade/gestao/nao-conformidades', {
      ...trat,
      versao: 2,
      situacao: 'encerrada',
      eficacia: 'eficaz',
      eficaciaTexto: 'Sem recorrência.',
    });
    expect([pulo.statusCode, codigo(pulo)]).toEqual([422, 'transicao-invalida']);
    const det = json<{ naoConformidades: number }>(await a.get(qu, `/qualidade/gestao/auditorias/${id}`));
    expect(det.naoConformidades).toBe(1);
    const lista = json<{ itens: { id: number; situacao: string; vencida: boolean }[] }>(
      await a.get(qu, '/qualidade/gestao/nao-conformidades'),
    );
    expect(lista.itens.find((x) => x.id === ncId)).toMatchObject({
      situacao: 'emTratamento',
      vencida: false,
    });
  });

  it('comissão com a composição, reunião com a presença e o quórum; nome repetido e presente fora recusados', async () => {
    const c = {
      comissao: null,
      versao: null,
      tipo: 'ccih',
      nome: 'Comissão de controle de infecção',
      periodicidade: 'mensal',
      membros: [
        { nome: 'Médica infectologista', funcao: 'Presidente', login: null },
        { nome: 'Enfermeira da CCIH', funcao: 'Secretária', login: 'SINT.CCIH' },
        { nome: 'Farmacêutico', funcao: 'Membro', login: null },
      ],
      ativa: true,
    };
    const r = await a.post(qu, '/qualidade/gestao/comissoes', c);
    expect(r.statusCode, r.body).toBe(201);
    const id = json<{ id: number }>(r).id;
    const dup = await a.post(qu, '/qualidade/gestao/comissoes', c);
    expect([dup.statusCode, codigo(dup)]).toEqual([409, 'comissao-duplicada']);
    const reuniao = {
      tipo: 'ordinaria',
      realizadaEm: '2026-10-20T14:00',
      pauta: 'Indicadores de setembro',
      ata: 'Apresentada a densidade de IPCS; aprovado o reforço do bundle (sintético).',
      versaoComissao: 1,
      presentes: [0, 1],
      convidados: null,
      deliberacoes: null,
    };
    const fora = await a.post(qu, `/qualidade/gestao/comissoes/${id}/reunioes`, {
      ...reuniao,
      presentes: [0, 3],
    });
    expect([fora.statusCode, codigo(fora)]).toEqual([422, 'presente-fora-da-composicao']);
    expect((await a.post(qu, `/qualidade/gestao/comissoes/${id}/reunioes`, reuniao)).statusCode).toBe(201);
    const rs = json<{ itens: { presentes: string[]; quorum: boolean }[] }>(
      await a.get(qu, `/qualidade/gestao/comissoes/${id}/reunioes`),
    );
    expect(rs.itens[0]).toMatchObject({
      presentes: ['Médica infectologista', 'Enfermeira da CCIH'],
      quorum: true,
    });
    const cs = json<{ itens: { proximaReuniaoAte: string; atrasada: boolean }[] }>(
      await a.get(qu, '/qualidade/gestao/comissoes'),
    );
    expect(cs.itens[0]).toMatchObject({ proximaReuniaoAte: '2026-11-20', atrasada: false });
    // A composição muda com o formulário da reunião aberto: as posições lidas na versão 1 não valem mais.
    // Revisão do W0-04: alterar a comissão exige a justificativa e guarda a composição anterior como versão.
    const semMotivo = await a.post(qu, '/qualidade/gestao/comissoes', {
      ...c,
      comissao: id,
      versao: 1,
      membros: [c.membros[2]!, c.membros[0]!, c.membros[1]!],
    });
    expect(semMotivo.statusCode).toBe(400);
    const alterada = await a.post(qu, '/qualidade/gestao/comissoes', {
      ...c,
      comissao: id,
      versao: 1,
      membros: [c.membros[2]!, c.membros[0]!, c.membros[1]!],
      justificativa: 'Troca da presidência da comissão',
    });
    expect(alterada.statusCode, alterada.body).toBe(201);
    const vs = json<{ itens: { acao: string; motivo: string }[] }>(
      await a.get(qu, `/qualidade/gestao/versoes/comissao/${id}`),
    ).itens;
    expect(vs.map((v) => [v.acao, v.motivo])).toEqual([['correcao', 'Troca da presidência da comissão']]);
    const antiga = await a.post(qu, `/qualidade/gestao/comissoes/${id}/reunioes`, {
      ...reuniao,
      realizadaEm: '2026-10-21T14:00',
    });
    expect([antiga.statusCode, codigo(antiga)]).toEqual([409, 'versao-desatualizada']);
    expect(
      json<{ itens: unknown[] }>(await a.get(qu, `/qualidade/gestao/comissoes/${id}/reunioes`)).itens,
    ).toHaveLength(1);
  });

  it('risco com a pontuação e a prioridade GUT; o crítico tratado exige controles; a reavaliação confere a versão', async () => {
    const risco = {
      risco: null,
      versao: null,
      titulo: 'Troca de medicação por nomes parecidos',
      descricao: 'Ampolas de aparência semelhante no mesmo escaninho (sintético).',
      area: 'Farmácia',
      categoria: 'assistencial',
      gravidade: 5,
      urgencia: 4,
      tendencia: 4,
      controles: null,
      responsavel: 'Farmácia',
      situacao: 'emTratamento',
      reavaliarEm: '2026-12-01',
      justificativa: null,
    };
    const sem = await a.post(qu, '/qualidade/gestao/riscos', risco);
    expect([sem.statusCode, codigo(sem)]).toEqual([422, 'controles-obrigatorios']);
    const r = await a.post(qu, '/qualidade/gestao/riscos', {
      ...risco,
      controles: 'Separação física e etiqueta de alerta.',
    });
    expect(r.statusCode, r.body).toBe(201);
    const lista = json<{ itens: { id: number; pontuacao: number; prioridade: string }[] }>(
      await a.get(qu, '/qualidade/gestao/riscos'),
    );
    expect(lista.itens[0]).toMatchObject({ pontuacao: 80, prioridade: 'critica' });
    const id = lista.itens[0]!.id;
    const velha = await a.post(qu, '/qualidade/gestao/riscos', {
      ...risco,
      risco: id,
      versao: 9,
      controles: 'x'.repeat(12),
    });
    expect([velha.statusCode, codigo(velha)]).toEqual([409, 'versao-desatualizada']);
    const resumo = json<{ riscosCriticos: number }>(await a.get(qu, '/qualidade/gestao/resumo'));
    expect(resumo.riscosCriticos).toBe(1);
    const escala = json<{ escala: { gravidade: string[] } }>(await a.get(qu, '/qualidade/gestao/escala-gut'));
    expect(escala.escala.gravidade).toHaveLength(5);
  });
});

describe('ouvidoria', () => {
  it('registra com protocolo e prazo de 10 dias úteis, encaminha e responde; a trilha sem relato nem manifestante', async () => {
    const m = {
      canal: 'telefone',
      tipo: 'reclamacao',
      identificada: true,
      paciente: null,
      manifestante: 'Maria Sintética',
      contato: '(22) 0000-0000',
      area: 'Recepção',
      relato: 'Demora de duas horas na recepção (sintético).',
      recebidaEm: '2026-10-27T09:00',
      pesquisa: null,
    };
    const r = await a.post(ou, '/qualidade/ouvidoria/manifestacoes', m);
    expect(r.statusCode, r.body).toBe(201);
    const b = json<{ id: number; protocolo: string; prazoEm: string }>(r);
    expect(b.protocolo).toMatch(/^OUV-2026-\d{6}$/);
    // 28, 29, 30 e 3 (2/11 feriado), 4, 5, 6, 9, 10, 11 de novembro.
    expect(b.prazoEm).toBe('2026-11-11T23:59:59');
    // Quem liga dá o protocolo: a busca acha pelo protocolo igual (sem diferenciar maiúsculas) e por trecho do relato.
    const buscar = async (busca: string) =>
      json<{ itens: { id: number }[]; total: number }>(
        await a.get(ou, `/qualidade/ouvidoria/manifestacoes?busca=${encodeURIComponent(busca)}`),
      );
    expect((await buscar(b.protocolo.toLowerCase())).itens.map((x) => x.id)).toEqual([b.id]);
    expect((await buscar('duas horas')).itens.map((x) => x.id)).toContain(b.id);
    expect((await buscar('OUV-1999-000001')).total).toBe(0);
    expect((await a.get(ou, `/qualidade/ouvidoria/manifestacoes?busca=${'x'.repeat(61)}`)).statusCode).toBe(
      400,
    );
    const enc = await a.post(ou, `/qualidade/ouvidoria/manifestacoes/${b.id}/encaminhamento`, {
      versao: 1,
      encaminhadaA: 'Coordenação da recepção',
      observacao: null,
    });
    expect(enc.statusCode, enc.body).toBe(201);
    const semProc = await a.post(ou, `/qualidade/ouvidoria/manifestacoes/${b.id}/resposta`, {
      versao: 2,
      resposta: 'Reforçamos a escala da recepção.',
      procedente: null,
    });
    expect([semProc.statusCode, codigo(semProc)]).toEqual([422, 'procedencia-obrigatoria']);
    const resp = await a.post(ou, `/qualidade/ouvidoria/manifestacoes/${b.id}/resposta`, {
      versao: 2,
      resposta: 'Reforçamos a escala da recepção.',
      procedente: true,
    });
    expect(resp.statusCode, resp.body).toBe(201);
    const de_novo = await a.post(ou, `/qualidade/ouvidoria/manifestacoes/${b.id}/resposta`, {
      versao: 3,
      resposta: 'De novo, sintético.',
      procedente: true,
    });
    expect([de_novo.statusCode, codigo(de_novo)]).toEqual([409, 'manifestacao-respondida']);
    const det = json<{ situacao: string; estadoPrazo: string; manifestante: string }>(
      await a.get(ou, `/qualidade/ouvidoria/manifestacoes/${b.id}`),
    );
    expect(det).toMatchObject({
      situacao: 'respondida',
      estadoPrazo: 'cumprido',
      manifestante: 'Maria Sintética',
    });
    const trilha = JSON.stringify(a.trilha.eventos.filter((l) => l.evento.startsWith('qualidade.ouvidoria')));
    expect(trilha).not.toContain('Maria');
    expect(trilha).not.toContain('Demora');
    expect(trilha).toContain('qualidade.ouvidoria.lida');
    expect((await a.get(vi, '/qualidade/ouvidoria/manifestacoes')).statusCode).toBe(403);
  });

  it('a anônima não leva identificação; a resposta da pesquisa vira manifestação uma vez, com o paciente da conta', async () => {
    const anon = await a.post(ou, '/qualidade/ouvidoria/manifestacoes', {
      canal: 'caixa',
      tipo: 'sugestao',
      identificada: false,
      paciente: null,
      manifestante: 'Nome',
      contato: null,
      area: 'Hotelaria',
      relato: 'Sugestão de mais cadeiras (sintético).',
      recebidaEm: '2026-10-26T10:00',
      pesquisa: null,
    });
    expect(anon.statusCode).toBe(400);
    const pesq = json<{ itens: { id: number; nota: number }[] }>(
      await a.get(ou, '/qualidade/ouvidoria/pesquisas?competencia=2026-09'),
    );
    expect(pesq.itens.map((p) => p.nota)).toEqual([9, 4]);
    const m = {
      canal: 'pesquisa',
      tipo: 'reclamacao',
      identificada: true,
      paciente: null,
      manifestante: null,
      contato: null,
      area: 'Recepção',
      relato: 'Esperei muito na recepção (sintético).',
      recebidaEm: '2026-10-27T08:00',
      pesquisa: GESTAO_SINTETICA.pesquisaDetrator,
    };
    const r = await a.post(ou, '/qualidade/ouvidoria/manifestacoes', m);
    expect(r.statusCode, r.body).toBe(201);
    const det = json<{ paciente: { id: number; nome: string } }>(
      await a.get(ou, `/qualidade/ouvidoria/manifestacoes/${json<{ id: number }>(r).id}`),
    );
    expect(det.paciente).toEqual({ id: GESTAO_SINTETICA.paciente, nome: 'PACIENTE SINTETICO OUVIDORIA' });
    const dup = await a.post(ou, '/qualidade/ouvidoria/manifestacoes', m);
    expect([dup.statusCode, codigo(dup)]).toEqual([409, 'pesquisa-ja-convertida']);
    const nps = json<{ itens: { competencia: string; nps: number | null; conta: string | null }[] }>(
      await a.get(ou, '/qualidade/ouvidoria/nps?competencia=2026-09'),
    );
    expect(nps.itens).toHaveLength(6);
    // 10 e 9 promotores, 4 detrator: (2 − 1) ÷ 3 × 100 = 33,3.
    expect(nps.itens.at(-1)).toMatchObject({
      competencia: '2026-09',
      nps: 33.3,
      conta: '(2 − 1) ÷ 3 × 100 = 33,3',
    });
  });
});

describe('envios regulatórios', () => {
  it('gera o arquivo com o resumo SHA-256, substitui na nova geração, transmite com o mesmo resumo e bloqueia depois', async () => {
    const aberta = await a.post(cc, '/relatorio/envios-regulatorios', {
      tipo: 'iras',
      competencia: '2026-10',
    });
    expect([aberta.statusCode, codigo(aberta)]).toEqual([422, 'competencia-aberta']);
    const g1 = await a.post(cc, '/relatorio/envios-regulatorios', { tipo: 'iras', competencia: '2026-09' });
    expect(g1.statusCode, g1.body).toBe(201);
    const b1 = json<{ id: number; revisao: number; hash: string; conteudo: string; arquivo: string }>(g1);
    expect(b1).toMatchObject({ revisao: 1, arquivo: 'iras-aa-2026-09-r1.csv' });
    // VM-dia 2 e densidade 0: a ventilação da extubação não planejada do W0-04 (M2) entra no mock de setembro.
    expect(b1.conteudo.split('\r\n')[1]).toBe('2026-09;UTI SINT;300;10;1;100;0;0;;2;0;0');
    const g2 = await a.post(cc, '/relatorio/envios-regulatorios', { tipo: 'iras', competencia: '2026-09' });
    const b2 = json<{ id: number; revisao: number; hash: string }>(g2);
    expect(b2.revisao).toBe(2);
    expect(b2.hash).toBe(b1.hash);
    const lista = json<{ itens: { id: number; situacao: string }[]; competenciaSugerida: string }>(
      await a.get(cc, '/relatorio/envios-regulatorios'),
    );
    expect(lista.competenciaSugerida).toBe('2026-09');
    expect(lista.itens.map((e) => e.situacao)).toEqual(['gerado', 'substituido']);
    const arq = json<{ igual: boolean }>(await a.get(cc, `/relatorio/envios-regulatorios/${b2.id}/arquivo`));
    expect(arq.igual).toBe(true);
    const outro = await a.post(cc, `/relatorio/envios-regulatorios/${b2.id}/transmissao`, {
      versao: 1,
      transmitidoEm: '2026-10-27T12:05',
      protocolo: 'IRAS-SINT-1',
      hash: 'f'.repeat(64),
    });
    expect([outro.statusCode, codigo(outro)]).toEqual([422, 'hash-diferente']);
    const t = await a.post(cc, `/relatorio/envios-regulatorios/${b2.id}/transmissao`, {
      versao: 1,
      transmitidoEm: '2026-10-27T12:05',
      protocolo: 'IRAS-SINT-1',
      hash: b2.hash,
    });
    expect(t.statusCode, t.body).toBe(201);
    const depois = await a.post(cc, '/relatorio/envios-regulatorios', {
      tipo: 'iras',
      competencia: '2026-09',
    });
    expect([depois.statusCode, codigo(depois)]).toEqual([409, 'ja-transmitido']);
  });

  it('Notivisa com os incidentes e o prazo; PM-QUALISS com os indicadores do programa', async () => {
    const n = json<{ id: number; conteudo: string; resumo: Record<string, number> }>(
      await a.post(nsp, '/relatorio/envios-regulatorios', { tipo: 'notivisa', competencia: '2026-09' }),
    );
    expect(n.resumo).toEqual({ notificacoes: 2, obitos: 0, transcritas: 1, pendentes: 1 });
    expect(n.conteudo).not.toMatch(/PACIENTE/);
    const q = json<{ conteudo: string; resumo: Record<string, number> }>(
      await a.post(qu, '/relatorio/envios-regulatorios', { tipo: 'pmQualiss', competencia: '2026-09' }),
    );
    expect(q.conteudo).toContain('densidadeIpcsCvc');
    expect(q.resumo['semAnalise']).toBeLessThan(q.resumo['indicadores']!);
    expect(
      (await a.post(ou, '/relatorio/envios-regulatorios', { tipo: 'iras', competencia: '2026-08' }))
        .statusCode,
    ).toBe(403);
  });

  it('cada envio pede a permissão dos dados dele: a CCIH não lê os incidentes do NSP, nem o NSP as IRAS', async () => {
    const n = json<{ id: number; hash: string }>(
      await a.post(nsp, '/relatorio/envios-regulatorios', { tipo: 'notivisa', competencia: '2026-08' }),
    );
    const gerarCcih = await a.post(cc, '/relatorio/envios-regulatorios', {
      tipo: 'notivisa',
      competencia: '2026-08',
    });
    expect([gerarCcih.statusCode, codigo(gerarCcih)]).toEqual([403, 'sem-permissao-envio']);
    expect((await a.get(cc, `/relatorio/envios-regulatorios/${n.id}/arquivo`)).statusCode).toBe(403);
    const tx = await a.post(cc, `/relatorio/envios-regulatorios/${n.id}/transmissao`, {
      versao: 1,
      transmitidoEm: '2026-10-27T12:05',
      protocolo: 'NTV-SINT-1',
      hash: n.hash,
    });
    expect(tx.statusCode).toBe(403);
    // A qualidade gera o PM-QUALISS, mas não lê os incidentes do NSP nem as infecções da CCIH.
    expect(
      (await a.post(qu, '/relatorio/envios-regulatorios', { tipo: 'notivisa', competencia: '2026-08' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await a.post(nsp, '/relatorio/envios-regulatorios', { tipo: 'iras', competencia: '2026-08' }))
        .statusCode,
    ).toBe(403);
    const tipos = async (s: Sessao) =>
      json<{ tipos: { codigo: string }[]; itens: { tipo: string }[] }>(
        await a.get(s, '/relatorio/envios-regulatorios'),
      );
    const daCcih = await tipos(cc);
    expect(daCcih.tipos.map((t) => t.codigo).sort()).toEqual(['iras', 'pmQualiss']);
    expect(daCcih.itens.some((x) => x.tipo === 'notivisa')).toBe(false);
    const doNsp = await tipos(nsp);
    expect(doNsp.tipos.map((t) => t.codigo).sort()).toEqual(['notivisa', 'pmQualiss']);
    expect(doNsp.itens.some((x) => x.tipo === 'iras')).toBe(false);
    expect((await tipos(qu)).tipos.map((t) => t.codigo)).toEqual(['pmQualiss']);
  });
});

describe('liberação', () => {
  it('sem a chave qualidade.gestao: lê, mas não grava (403 recurso-desligado)', async () => {
    const b = await montar({ semChave: true });
    try {
      const s = await b.entrar('SINT.QUALIDADE');
      const resumo = json<{ ligada: boolean; motivo: string | null }>(
        await b.get(s, '/qualidade/gestao/resumo'),
      );
      expect(resumo.ligada).toBe(false);
      expect(resumo.motivo).toBeTruthy();
      const r = await b.post(s, '/qualidade/documentos', pop);
      expect([r.statusCode, codigo(r)]).toEqual([403, 'recurso-desligado']);
    } finally {
      await b.app.close();
    }
  });
});
