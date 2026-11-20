// M48, etapa 5 (gestão da qualidade ONA e envios regulatórios), sobre a cópia (transação DESFEITA, sob a trava; ficha,
// seções 4, 5, 7 e 8; regras 9, 10 e 11): a API inteira (sessões sintéticas SINT.QUALIDADE e SINT.OUVIDORIA, guardas e
// interceptores) com a porta da gestão e a da CCIH sobre UMA transação da cópia:
//   - o documento publicado (o elaborador é outra pessoa), a ciência de outro usuário, a nova revisão que torna a
//     anterior obsoleta e a retirada; quem não publica vê só a vigente;
//   - regra 9: os indicadores de uma competência fechada da cópia (os do censo e os da CCIH, com a conta das parcelas)
//     e a análise crítica gravada com o valor apurado;
//   - a auditoria por checklist com a conformidade, a não conformidade aberta a partir dela e o ciclo até o tratamento,
//     o risco GUT com a pontuação, a comissão e a reunião com o quórum;
//   - a ouvidoria: a manifestação anônima (nada que identifique), o encaminhamento, a resposta e a leitura da pesquisa
//     e do NPS da cópia;
//   - regra 10: os três envios gerados com o resumo SHA-256, o arquivo gerado de novo igual e a transmissão manual;
//   - regra 11: a trilha só com os IDs (nenhuma linha nova com o relato, o manifestante ou o conteúdo);
//   - as leituras com o tempo; o ROLLBACK conferido pelas contagens das SGH_QUA_* da etapa e da maior chave da trilha.
// Nada de paciente sai daqui: só contagens, códigos e tempos (abaixo de 5 vira "<5").
import { writeFileSync } from 'node:fs';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Leitor } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import {
  type AmbienteM27,
  ambienteM27,
  PODE_ESCREVER,
  percentil,
} from '../acesso/aplicacao/copia.spec-util.js';
import { portaCcihNaTransacao } from './porta-ccih-legado.js';
import { portaGestaoNaTransacao } from './porta-gestao-legado.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const n = (v: unknown) => Number(v ?? 0);
const mascara = (x: number) => (x > 0 && x < 5 ? '<5' : String(x));
const passo = (s: string) => console.log(`[m48.5] ${s}`);
const TABELAS = [
  'SGH_QUA_DOCUMENTO',
  'SGH_QUA_DOC_CIENCIA',
  'SGH_QUA_IND_ANALISE',
  'SGH_QUA_AUDITORIA',
  'SGH_QUA_COMISSAO',
  'SGH_QUA_COMISSAO_REUNIAO',
  'SGH_QUA_RISCO',
  'SGH_QUA_NAO_CONFORM',
  'SGH_QUA_OUVIDORIA',
  'SGH_QUA_ENVIO_REG',
];
// A cópia é um retrato de 2026 com o último atendimento em 07/2026: a competência fechada de junho tem censo, IRAS e
// incidentes reais (D-COMPETENCIA-INT-48.5).
const COMPETENCIA = process.env['M48_5_COMPETENCIA'] ?? '2026-06';
// Textos únicos da execução: a trilha não pode trazer nenhum deles (regra 11).
const MARCA = `M485INT${Date.now().toString(36).toUpperCase()}`;

async function contagens(l: Pick<Leitor, 'consultar'>): Promise<number[]> {
  const r: number[] = [];
  for (const t of TABELAS)
    r.push(n((await l.consultar(`SELECT COUNT(*) N FROM ${t}`, [], { teto: 1 }))[0]?.['N']));
  const [m] = await l.consultar('SELECT MAX(ID) M FROM SGH_TRILHA', [], { teto: 1 });
  r.push(n(m?.['M']));
  return r;
}

async function tempos(vezes: number, fn: () => Promise<unknown>): Promise<number> {
  const xs: number[] = [];
  for (let i = 0; i < vezes; i++) {
    const t0 = performance.now();
    await fn();
    xs.push(performance.now() - t0);
  }
  return Math.round(percentil(xs, 95));
}

type Resp = { statusCode: number; body: string };

describe.skipIf(!PODE_ESCREVER)('gestão da qualidade na cópia (transação desfeita)', () => {
  let a: AmbienteM27;
  let antes: number[];
  beforeAll(async () => {
    a = await ambienteM27();
    antes = await a.nucleo.lerSomente({ ...a.c, traceId: 'int-m48-5' }, (l) => contagens(l));
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('documentos, indicadores, auditoria, não conformidade, risco, comissão, ouvidoria, envios e os tempos', async () => {
    const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m48-5-gestao' }, async (e) => {
      const [maxTrilha] = await e.consultar('SELECT MAX(ID) M FROM SGH_TRILHA', [], { teto: 1 });
      const trilhaAntes = n(maxTrilha?.['M']);
      const app: NestFastifyApplication = await criarApp(lerConfiguracao(env), null, env, {
        trilha: new RegistradorTrilhaMemoria(),
        gestao: portaGestaoNaTransacao(e, a.cod),
        ccih: portaCcihNaTransacao(e, a.cod),
        vigiaEnfermagem: null,
        vigia: null,
      });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      let seq = 0;
      const entrar = async (login: string) => {
        const s = await app.inject({
          method: 'POST',
          url: '/api/sessao',
          payload: { estabelecimento: 'aa', login, senha: SENHA },
        });
        expect(s.statusCode, s.body.slice(0, 200)).toBe(201);
        const set = s.headers['set-cookie'] as string[];
        return {
          cookie: set.map((c) => c.split(';')[0]).join('; '),
          csrf:
            set
              .find((c) => c.startsWith('sgh_csrf='))
              ?.split(';')[0]
              ?.slice(9) ?? '',
        };
      };
      try {
        const qu = await entrar('SINT.QUALIDADE');
        const ou = await entrar('SINT.OUVIDORIA');
        const get = (s: { cookie: string }, url: string) =>
          app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
        const post = (s: { cookie: string; csrf: string }, url: string, payload: unknown = {}) =>
          app.inject({
            method: 'POST',
            url: `/api${url}`,
            headers: {
              cookie: s.cookie,
              'x-csrf': s.csrf,
              'idempotency-key': `int-m48-5-${String(++seq)}-${Date.now()}`,
            },
            payload: payload as object,
          });
        const ok = <T = Record<string, unknown>>(x: Resp) => {
          expect(x.statusCode, x.body.slice(0, 300)).toBeLessThan(300);
          return JSON.parse(x.body) as T;
        };
        const codigo = (x: Resp) => (JSON.parse(x.body) as { codigo?: string }).codigo;

        // ── Resumo ──
        const resumo = ok<{ ligada: boolean; agora: string; podeRegistrar: boolean }>(
          await get(qu, '/qualidade/gestao/resumo'),
        );
        expect(resumo.ligada).toBe(true);
        expect(resumo.podeRegistrar).toBe(true);
        const agora = resumo.agora.slice(0, 16);
        const hoje = agora.slice(0, 10);
        const vigencia = `${String(Number(hoje.slice(0, 4)) + 2)}${hoje.slice(4)}`;

        // ── Documentos ──
        const codigoDoc = `POP-${MARCA.slice(-8)}`;
        const doc = {
          codigo: codigoDoc,
          tipo: 'pop',
          titulo: `Procedimento sintético ${MARCA}`,
          area: 'Enfermagem',
          conteudo: `Conteúdo sintético do procedimento ${MARCA} com mais de vinte caracteres.`,
          resumoAlteracao: null,
          elaboradoPor: 'SINT.OUVIDORIA',
          revisadoPor: null,
          vigenciaAte: vigencia,
          exigeCiencia: true,
          substitui: null,
        };
        const proprio = await post(qu, '/qualidade/documentos', { ...doc, elaboradoPor: 'SINT.QUALIDADE' });
        expect([proprio.statusCode, codigo(proprio)]).toEqual([422, 'aprovador-e-elaborador']);
        const r1 = ok<{ id: number; revisao: number; hash: string }>(
          await post(qu, '/qualidade/documentos', doc),
        );
        expect(r1.revisao).toBe(1);
        expect(r1.hash).toMatch(/^[0-9a-f]{64}$/);
        ok(await post(ou, `/qualidade/documentos/${String(r1.id)}/ciencia`));
        const dupla = await post(ou, `/qualidade/documentos/${String(r1.id)}/ciencia`);
        expect(dupla.statusCode).toBeGreaterThanOrEqual(400);
        const lido1 = ok<{ versao: number; ciencias: number }>(
          await get(qu, `/qualidade/documentos/${String(r1.id)}`),
        );
        expect(lido1.ciencias).toBe(1);
        const r2 = ok<{ id: number; revisao: number }>(
          await post(qu, '/qualidade/documentos', {
            ...doc,
            resumoAlteracao: 'Revisão sintética.',
            substitui: { id: r1.id, versao: lido1.versao },
          }),
        );
        expect(r2.revisao).toBe(2);
        const anterior = ok<{ situacao: string }>(await get(qu, `/qualidade/documentos/${String(r1.id)}`));
        expect(anterior.situacao).toBe('obsoleto');
        // Quem não publica vê só a vigente: a obsoleta é 404.
        expect((await get(ou, `/qualidade/documentos/${String(r1.id)}`)).statusCode).toBe(404);
        const lido2 = ok<{ versao: number }>(await get(qu, `/qualidade/documentos/${String(r2.id)}`));
        ok(
          await post(qu, `/qualidade/documentos/${String(r2.id)}/retirada`, {
            versao: lido2.versao,
            motivo: 'Retirada sintética do teste de integração.',
          }),
        );
        passo('documento: publicado, ciência, revisão 2 (anterior obsoleta) e retirada');

        // ── Indicadores ──
        const ind = ok<{
          itens: {
            ficha: { codigo: string; origem: string };
            valor: number | null;
            conta: string | null;
            situacaoMeta: string;
            numerador: number | null;
          }[];
        }>(await get(qu, `/qualidade/indicadores?competencia=${COMPETENCIA}`));
        const comValor = ind.itens.filter((i) => i.valor !== null);
        for (const i of comValor) expect(i.conta, i.ficha.codigo).toMatch(/=/);
        passo(
          `indicadores de ${COMPETENCIA}: ${String(ind.itens.length)} (censo ${String(ind.itens.filter((i) => i.ficha.origem === 'censo').length)}, qualidade ${String(ind.itens.filter((i) => i.ficha.origem === 'qualidade').length)}), com valor ${String(comValor.length)}`,
        );
        const alvo = comValor.find((i) => i.situacaoMeta !== 'fora-da-meta') ?? comValor[0] ?? ind.itens[0]!;
        const fora = alvo.situacaoMeta === 'fora-da-meta';
        const an = ok<{ id: number }>(
          await post(qu, `/qualidade/indicadores/${alvo.ficha.codigo}/analise`, {
            analise: null,
            versao: null,
            competencia: COMPETENCIA,
            texto: `Análise sintética ${MARCA} da competência.`,
            causas: fora ? 'Causa sintética.' : null,
            plano: fora ? 'Plano sintético.' : null,
            responsavel: fora ? 'Qualidade' : null,
            prazo: fora ? vigencia : null,
          }),
        );
        expect(an.id).toBeGreaterThan(0);
        const hist = ok<{ itens: { indicador: string; numerador: number }[] }>(
          await get(qu, `/qualidade/indicadores/${alvo.ficha.codigo}/analises`),
        );
        expect(hist.itens[0]?.indicador).toBe(alvo.ficha.codigo);
        expect(hist.itens[0]?.numerador).toBe(alvo.numerador ?? 0);

        // ── Auditoria, não conformidade e risco ──
        const aud = ok<{ id: number; resultado: { conformidade: number; conta: string } }>(
          await post(qu, '/qualidade/gestao/auditorias', {
            titulo: `Auditoria sintética ${MARCA}`,
            area: 'UTI',
            referencial: 'interno',
            realizadaEm: hoje,
            auditores: 'Auditor sintético',
            itens: [
              { requisito: 'Requisito sintético 1', secao: 'S1', resultado: 'conforme', evidencia: null },
              {
                requisito: 'Requisito sintético 2',
                secao: 'S1',
                resultado: 'parcial',
                evidencia: 'Achado sintético.',
              },
              { requisito: 'Requisito sintético 3', secao: null, resultado: 'naoAplicavel', evidencia: null },
            ],
            conclusao: 'Conclusão sintética da auditoria.',
          }),
        );
        expect(aud.resultado.conformidade).toBe(75);
        const nc = ok<{ id: number; versao: number }>(
          await post(qu, '/qualidade/gestao/nao-conformidades', {
            naoConformidade: null,
            versao: null,
            origem: 'auditoria',
            idOrigem: aud.id,
            descricao: `Não conformidade sintética ${MARCA}.`,
            area: 'UTI',
            classificacao: 'menor',
            acaoImediata: null,
            causa: null,
            plano: null,
            responsavel: null,
            prazo: null,
            situacao: 'aberta',
            eficacia: null,
            eficaciaTexto: null,
          }),
        );
        const origemFalsa = await post(qu, '/qualidade/gestao/nao-conformidades', {
          naoConformidade: null,
          versao: null,
          origem: 'auditoria',
          idOrigem: 999_999_999,
          descricao: 'Não conformidade sintética sem origem.',
          area: 'UTI',
          classificacao: 'menor',
          acaoImediata: null,
          causa: null,
          plano: null,
          responsavel: null,
          prazo: null,
          situacao: 'aberta',
          eficacia: null,
          eficaciaTexto: null,
        });
        expect(origemFalsa.statusCode).toBe(422);
        const ncs = ok<{ itens: { id: number; versao: number; situacao: string }[] }>(
          await get(qu, '/qualidade/gestao/nao-conformidades?situacao=aberta'),
        );
        const ncLida = ncs.itens.find((x) => x.id === nc.id)!;
        ok(
          await post(qu, '/qualidade/gestao/nao-conformidades', {
            naoConformidade: nc.id,
            versao: ncLida.versao,
            origem: 'auditoria',
            idOrigem: aud.id,
            descricao: `Não conformidade sintética ${MARCA}.`,
            area: 'UTI',
            classificacao: 'menor',
            acaoImediata: null,
            causa: 'Causa sintética.',
            plano: 'Plano sintético.',
            responsavel: 'Coordenação',
            prazo: vigencia,
            situacao: 'emTratamento',
            eficacia: null,
            eficaciaTexto: null,
          }),
        );
        const auditoriaLida = ok<{ naoConformidades: number }>(
          await get(qu, `/qualidade/gestao/auditorias/${String(aud.id)}`),
        );
        expect(auditoriaLida.naoConformidades).toBe(1);
        ok(
          await post(qu, '/qualidade/gestao/riscos', {
            risco: null,
            versao: null,
            titulo: `Risco sintético ${MARCA}`,
            descricao: 'Descrição sintética do risco.',
            area: 'Internação',
            categoria: 'assistencial',
            gravidade: 4,
            urgencia: 4,
            tendencia: 4,
            controles: null,
            responsavel: 'Coordenação',
            situacao: 'identificado',
            reavaliarEm: vigencia,
            justificativa: null,
          }),
        );
        const riscos = ok<{ itens: { titulo: string; pontuacao: number; prioridade: string }[] }>(
          await get(qu, '/qualidade/gestao/riscos'),
        );
        expect(riscos.itens.find((x) => x.titulo.includes(MARCA))).toMatchObject({
          pontuacao: 64,
          prioridade: 'critica',
        });

        // ── Comissão e reunião ──
        const com = ok<{ id: number }>(
          await post(qu, '/qualidade/gestao/comissoes', {
            comissao: null,
            versao: null,
            tipo: 'nsp',
            nome: `Comissão sintética ${MARCA}`,
            periodicidade: 'mensal',
            membros: [
              { nome: 'Membro sintético um', funcao: 'Presidente', login: null },
              { nome: 'Membro sintético dois', funcao: 'Secretária', login: null },
              { nome: 'Membro sintético três', funcao: 'Membro', login: null },
            ],
            ativa: true,
          }),
        );
        ok(
          await post(qu, `/qualidade/gestao/comissoes/${String(com.id)}/reunioes`, {
            tipo: 'ordinaria',
            realizadaEm: agora,
            versaoComissao: 1,
            pauta: 'Pauta sintética',
            ata: 'Ata sintética da reunião ordinária.',
            presentes: [0, 2],
            convidados: null,
            deliberacoes: null,
          }),
        );
        const reunioes = ok<{ itens: { quorum: boolean; presentesTotal: number }[] }>(
          await get(qu, `/qualidade/gestao/comissoes/${String(com.id)}/reunioes`),
        );
        expect(reunioes.itens[0]).toMatchObject({ quorum: true, presentesTotal: 2 });

        // ── Ouvidoria ──
        const man = ok<{ id: number; protocolo: string }>(
          await post(ou, '/qualidade/ouvidoria/manifestacoes', {
            canal: 'caixa',
            tipo: 'reclamacao',
            identificada: false,
            paciente: null,
            manifestante: null,
            contato: null,
            area: 'Recepção',
            relato: `Relato sintético ${MARCA} da manifestação.`,
            recebidaEm: agora,
            pesquisa: null,
          }),
        );
        expect(man.protocolo).toMatch(/\d/);
        const lista = ok<{
          itens: { id: number; versao: number; identificada: boolean; paciente: unknown }[];
        }>(await get(ou, '/qualidade/ouvidoria/manifestacoes?situacao=aberta'));
        const m1 = lista.itens.find((x) => x.id === man.id)!;
        expect([m1.identificada, m1.paciente]).toEqual([false, null]);
        const v2 = ok<{ versao: number }>(
          await post(ou, `/qualidade/ouvidoria/manifestacoes/${String(man.id)}/encaminhamento`, {
            versao: m1.versao,
            encaminhadaA: 'Recepção',
            observacao: null,
          }),
        );
        ok(
          await post(ou, `/qualidade/ouvidoria/manifestacoes/${String(man.id)}/resposta`, {
            versao: v2.versao,
            resposta: 'Resposta sintética ao manifestante.',
            procedente: true,
          }),
        );
        const pesquisas = ok<{ itens: unknown[]; cortada: boolean }>(
          await get(ou, `/qualidade/ouvidoria/pesquisas?competencia=${COMPETENCIA}`),
        );
        const nps = ok<{ itens: { respostas: number; nps: number | null }[] }>(
          await get(ou, `/qualidade/ouvidoria/nps?competencia=${COMPETENCIA}`),
        );
        expect(nps.itens).toHaveLength(6);
        passo(
          `ouvidoria: manifestação ${man.protocolo.replace(/\d/g, '9')} anônima respondida; pesquisas a tratar ${mascara(pesquisas.itens.length)}; respostas no semestre ${mascara(nps.itens.reduce((s, x) => s + x.respostas, 0))}`,
        );

        // ── Envios regulatórios ──
        const envios: Record<string, { linhas: number; hash: string }> = {};
        // Cada envio por quem tem os dados dele: as IRAS pela CCIH, o PM-QUALISS pela qualidade, o Notivisa pelo NSP.
        const cc = await entrar('SINT.CCIH');
        const nsp = await entrar('SINT.NSP');
        const quem = { iras: cc, pmQualiss: qu, notivisa: nsp };
        for (const tipo of ['iras', 'pmQualiss', 'notivisa'] as const) {
          const sx = quem[tipo];
          const g = ok<{ id: number; hash: string; linhas: number; revisao: number }>(
            await post(sx, '/relatorio/envios-regulatorios', { tipo, competencia: COMPETENCIA }),
          );
          const arq = ok<{ hash: string; igual: boolean }>(
            await get(sx, `/relatorio/envios-regulatorios/${String(g.id)}/arquivo`),
          );
          expect([arq.hash, arq.igual]).toEqual([g.hash, true]);
          envios[tipo] = { linhas: g.linhas, hash: g.hash.slice(0, 8) };
          if (tipo === 'iras') {
            const lidos = ok<{ itens: { id: number; versao: number }[] }>(
              await get(sx, '/relatorio/envios-regulatorios'),
            );
            const v = lidos.itens.find((x) => x.id === g.id)!.versao;
            const errado = await post(sx, `/relatorio/envios-regulatorios/${String(g.id)}/transmissao`, {
              versao: v,
              transmitidoEm: agora,
              protocolo: 'PROT-SINT',
              hash: 'f'.repeat(64),
            });
            expect(errado.statusCode).toBeGreaterThanOrEqual(400);
            ok(
              await post(sx, `/relatorio/envios-regulatorios/${String(g.id)}/transmissao`, {
                versao: v,
                transmitidoEm: agora,
                protocolo: 'PROT-SINT',
                hash: g.hash,
              }),
            );
          }
        }
        passo(`envios de ${COMPETENCIA}: ${JSON.stringify(envios)}`);

        // ── Regra 11: a trilha só com os IDs ──
        const [novas] = await e.consultar('SELECT COUNT(*) N FROM SGH_TRILHA WHERE ID > ?', [trilhaAntes], {
          teto: 1,
        });
        const [vazou] = await e.consultar(
          'SELECT COUNT(*) N FROM SGH_TRILHA WHERE ID > ? AND (CHAVE_NATURAL_ALVO CONTAINING ? OR DIFERENCA CONTAINING ?)',
          [trilhaAntes, MARCA, MARCA],
          { teto: 1 },
        );
        expect(n(vazou?.['N'])).toBe(0);
        expect(n(novas?.['N'])).toBeGreaterThanOrEqual(15);

        // ── Tempos ──
        const t = {
          resumo: await tempos(3, () => get(qu, '/qualidade/gestao/resumo')),
          documentos: await tempos(3, () => get(qu, '/qualidade/documentos')),
          indicadores: await tempos(3, () => get(qu, `/qualidade/indicadores?competencia=${COMPETENCIA}`)),
          riscos: await tempos(3, () => get(qu, '/qualidade/gestao/riscos')),
          manifestacoes: await tempos(3, () => get(ou, '/qualidade/ouvidoria/manifestacoes')),
          nps: await tempos(3, () => get(ou, `/qualidade/ouvidoria/nps?competencia=${COMPETENCIA}`)),
          envios: await tempos(3, () => get(qu, '/relatorio/envios-regulatorios')),
        };
        passo(`p95 (ms): ${JSON.stringify(t)}`);
        return {
          t,
          indicadores: ind.itens.length,
          comValor: comValor.length,
          envios,
          trilha: n(novas?.['N']),
        };
      } finally {
        await app.close();
      }
    });
    expect(r.t.indicadores).toBeLessThan(15_000);
    writeFileSync(process.env['M48_5_INT_SAIDA'] ?? '/dev/null', JSON.stringify(r));
    const depois = await a.nucleo.lerSomente({ ...a.c, traceId: 'int-m48-5-depois' }, (l) => contagens(l));
    expect(depois).toEqual(antes);
  }, 1_200_000);
});
