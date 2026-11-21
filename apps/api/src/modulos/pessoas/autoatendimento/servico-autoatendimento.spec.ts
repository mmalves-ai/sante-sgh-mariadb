// W0-06, parte 6b-2 (programa CRUD completo, M3 de mercado): as solicitações do autoatendimento pelo serviço da API.
// Pedido do próprio vínculo; desistência só de quem pediu (o ajuste pendente desiste junto); decisão nunca do
// solicitante nem do próprio vínculo; a aprovação grava o efeito na mesma transação (férias programadas, ajustes
// aprovados no ponto, correção do nome com o valor anterior) e, se o efeito recusar, a solicitação continua pendente;
// o atestado com o CID restrito e a trilha de acesso. Portas EM MEMÓRIA (nada conecta a banco); dados SINTÉTICOS.
import { describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import { idUsuarioSintetico } from '../../acesso/fonte-sintetica.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { CifraCpf } from '../cifra-cpf.js';
import { PortaCalculoFolhaMemoria } from '../folha/porta-calculo-memoria.js';
import { PortaFolhaMemoria } from '../folha/porta-folha-memoria.js';
import { ServicoFeriasFolha } from '../folha/servico-ferias.js';
import { PortaPontoMemoria } from '../ponto/porta-ponto-memoria.js';
import { PESSOAS_SINTETICAS_M52, PortaPessoasMemoria } from '../porta-memoria.js';
import type { PortaRubricas } from '../rubricas/porta-rubricas.js';
import { ServicoPessoas } from '../servico.js';
import { PortaAutoatendimentoMemoria } from './porta-autoatendimento-memoria.js';
import { PERMISSOES_AUTOATENDIMENTO, ServicoAutoatendimento } from './servico-autoatendimento.js';

type OpcoesConfiguracao = NonNullable<Parameters<typeof fonteConfiguracaoMemoria>[1]>;
type ChaveGravada = ReturnType<NonNullable<OpcoesConfiguracao['chavesIniciais']>>[number];
type PrerequisitoGravado = ReturnType<NonNullable<OpcoesConfiguracao['prerequisitosIniciais']>>[number];

const C = PESSOAS_SINTETICAS_M52;
const COLAB = C.ponto.login;
const chave = (c: string): ChaveGravada => ({
  id: c,
  tipo: 'recurso',
  chave: c,
  escopo: 'hospital',
  valor: '*',
  ligada: true,
  ligadaAntes: null,
  lote: null,
  justificativa: 'teste sintético',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});
const cumprido = (recurso: string): PrerequisitoGravado => ({
  recurso,
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'conferência sintética',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});
const cifra = new CifraCpf(Buffer.alloc(32, 7));

let k = 0;
function sessao(login = 'SINT.RH', pode: (p: string) => boolean = () => true): SessaoCadastro {
  return {
    req: {
      headers: { 'idempotency-key': `w006-solic-${++k}` },
      ip: '127.0.0.1',
      sgh: { sessao: { unidadeAtiva: null } },
    } as never,
    hospital: 'pc',
    rede: 'rede-sintetica',
    login,
    porta: {
      cliente: 'sintetico',
      estabelecimento: 1,
      usuario: null,
      correlacao: 'teste-l0302',
      rede: 'rede-sintetica',
      hospital: 'pc',
    },
    pode,
  };
}
const semCid = (p: string) => p !== PERMISSOES_AUTOATENDIMENTO.verCid;

async function erro(p: Promise<unknown>): Promise<ErroProblema> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErroProblema);
  return e as ErroProblema;
}
const codigo = async (p: Promise<unknown>) => {
  const e = await erro(p);
  return e.extras['codigo'] ?? e.tipo;
};

async function montar() {
  const pessoas = new PortaPessoasMemoria();
  pessoas.hojeFixo = '2026-10-25';
  const trilha = new RegistradorTrilhaMemoria();
  const recursos = ['pessoas.colaborador', 'pessoas.ponto', 'pessoas.folha'];
  const config = fonteConfiguracaoMemoria(trilha, {
    chavesIniciais: () => recursos.map(chave),
    prerequisitosIniciais: () => recursos.map(cumprido),
  });
  const rh = new ServicoPessoas(pessoas, trilha, config, null, cifra);
  const ponto = new PortaPontoMemoria(pessoas);
  ponto.agoraFixo = '2026-10-25T10:00';
  const folha = new PortaFolhaMemoria(pessoas);
  const calculo = new PortaCalculoFolhaMemoria(pessoas);
  folha.agoraFixo = '2026-10-25T10:00:00';
  calculo.agoraFixo = '2026-10-25T10:00:00';
  const rubricas = {
    rubricas: async () => [],
    tabelasLegais: async () => [],
    diasAfastamento: async () => [{ inicio: '2020-01-01', dias: 15 }],
  } as unknown as PortaRubricas;
  const ferias = new ServicoFeriasFolha(calculo, folha, rubricas, pessoas, trilha, config, null);
  const porta = new PortaAutoatendimentoMemoria(ponto, calculo, pessoas);
  const servico = new ServicoAutoatendimento(porta, pessoas, ponto, ferias, trilha, config, null);
  const vinculo = (
    await rh.admitir(sessao(), {
      cpf: C.ponto.cpf,
      nome: 'COLABORADORA DO PONTO SINTETICA',
      profissional: null,
      tipo: 'clt',
      admissao: '2025-01-05',
      cargo: 'Auxiliar administrativo',
      funcao: null,
      cargaSemanalHoras: 44,
      lotacao: { centroCusto: 9521, unidade: 1, setor: 'Posto 3' },
      matricula: null,
      usuario: idUsuarioSintetico(COLAB),
    })
  ).id;
  return { pessoas, ponto, calculo, ferias, porta, servico, vinculo };
}

const OBS = 'Pedido sintético do teste de unidade';
const abono = (inicio: string, fim: string) =>
  ({
    tipo: 'abono',
    vinculo: null,
    inicio,
    fim,
    movimento: 7,
    justificativa: 1,
    observacao: OBS,
  }) as const;
const decidir = (
  solicitacao: number,
  versao: number,
  decisao: 'aprovar' | 'recusar',
  motivo: string | null,
) => ({
  solicitacao,
  versao,
  decisao,
  motivo,
  movimento: null,
  justificativa: null,
  empresa: null,
  aquisitivoInicio: null,
});

describe('solicitações do autoatendimento (W0-06, M3)', () => {
  it('férias: o colaborador pede; o próprio não decide; o gestor aprova e a programação nasce na mesma operação', async () => {
    const m = await montar();
    const eu = sessao(COLAB);
    const r = await m.servico.incluir(eu, {
      tipo: 'ferias',
      vinculo: null,
      inicio: '2026-11-30',
      diasGozo: 20,
      diasAbono: 10,
      adiantaDecimo: false,
      observacao: null,
    });
    expect(r.solicitacao).toMatchObject({ situacao: 'pendente', vinculo: m.vinculo, ferias: null });
    expect(r.solicitacao!.acoes).toEqual({ desistir: true, decidir: false });
    expect(await codigo(m.servico.decidir(eu, decidir(r.id, 0, 'aprovar', null)))).toBe(
      'solicitacao-decisao-pelo-solicitante',
    );
    // A fila do gestor mostra a pendente com a ação; "minhas" do gestor não a mostra.
    const fila = await m.servico.fila(sessao(), { situacao: 'pendente' });
    expect(fila.itens.map((x) => [x.id, x.colaborador, x.acoes.decidir])).toEqual([
      [r.id, 'COLABORADORA DO PONTO SINTETICA', true],
    ]);
    expect((await m.servico.minhas(sessao(), {})).itens).toEqual([]);

    const ok = await m.servico.decidir(sessao(), decidir(r.id, 0, 'aprovar', null));
    expect(ok.solicitacao).toMatchObject({ situacao: 'aprovada', decididoPor: 'SINT.RH' });
    const ferias = ok.solicitacao!.ferias!;
    expect(ferias).toBeGreaterThan(0);
    const lista = await m.ferias.listar(sessao(), { vinculo: m.vinculo });
    expect(lista.itens.map((f) => [f.id, f.situacao, f.inicio, f.dias, f.abono])).toEqual([
      [ferias, 'programada', '2026-11-30', 20, 10],
    ]);
    // Decidida: nem desistência nem nova decisão.
    expect(
      await codigo(
        m.servico.desistir(eu, { solicitacao: r.id, versao: 1, motivo: 'Mudei de ideia sobre as férias' }),
      ),
    ).toBe('solicitacao-ja-decidida');
    expect(
      await codigo(m.servico.decidir(sessao('SINT.OUTRO'), decidir(r.id, 1, 'recusar', 'Já decidida antes'))),
    ).toBe('solicitacao-ja-decidida');
  });

  it('férias que a CLT recusa: 409 com o motivo da folha e a solicitação continua pendente', async () => {
    const m = await montar();
    const r = await m.servico.incluir(sessao(COLAB), {
      tipo: 'ferias',
      vinculo: null,
      inicio: '2026-12-04',
      diasGozo: 20,
      diasAbono: 0,
      adiantaDecimo: false,
      observacao: null,
    });
    expect(await codigo(m.servico.decidir(sessao(), decidir(r.id, 0, 'aprovar', null)))).toBe(
      'vespera-de-descanso',
    );
    expect((await m.porta.solicitacao(sessao().porta, r.id))?.situacao).toBe('pendente');
    expect((await m.ferias.listar(sessao(), { vinculo: m.vinculo })).itens).toEqual([]);
  });

  it('abono: a aprovação vira um ajuste justificativa aprovado por dia; o dia já justificado desfaz tudo', async () => {
    const m = await montar();
    const eu = sessao(COLAB);
    const a = await m.servico.incluir(eu, abono('2026-10-20', '2026-10-21'));
    expect(a.solicitacao!.ajustes).toEqual([]);
    const semMov = await m.servico.incluir(eu, { ...abono('2026-10-22', '2026-10-22'), movimento: null });
    expect(await codigo(m.servico.decidir(sessao(), decidir(semMov.id, 0, 'aprovar', null)))).toBe(
      'movimento-obrigatorio',
    );
    const ok = await m.servico.decidir(sessao(), decidir(a.id, 0, 'aprovar', 'Combinado com a chefia'));
    expect(ok.solicitacao!.ajustes.map((x) => [x.dia, x.situacao])).toEqual([
      ['2026-10-20', 'aprovado'],
      ['2026-10-21', 'aprovado'],
    ]);
    const ajustes = await m.ponto.ajustes(eu.porta, m.vinculo, '2026-10-01', '2026-10-31');
    expect(ajustes.map((x) => [x.tipo, x.movimento, x.pedidoPor, x.decididoPor])).toEqual([
      ['justificativa', 7, COLAB, 'SINT.RH'],
      ['justificativa', 7, COLAB, 'SINT.RH'],
    ]);
    // O mesmo dia de novo: o ponto recusa e nada fica gravado (a solicitação segue pendente, sem ajuste).
    const b = await m.servico.incluir(eu, abono('2026-10-21', '2026-10-21'));
    expect(await codigo(m.servico.decidir(sessao(), decidir(b.id, 0, 'aprovar', null)))).toBe(
      'dia-ja-justificado',
    );
    expect((await m.porta.solicitacao(eu.porta, b.id))?.situacao).toBe('pendente');
    expect(await m.porta.ajustesDaSolicitacao(eu.porta, b.id)).toEqual([]);
    expect(await m.ponto.ajustes(eu.porta, m.vinculo, '2026-10-01', '2026-10-31')).toHaveLength(2);
    // A recusa exige o motivo (contrato) e não mexe no ponto.
    const rec = await m.servico.decidir(sessao(), decidir(b.id, 0, 'recusar', 'O dia já estava abonado'));
    expect(rec.solicitacao).toMatchObject({ situacao: 'recusada', motivoDecisao: 'O dia já estava abonado' });
  });

  it('ajuste de ponto: nasce pendente ligado; só quem pediu desiste (o ajuste desiste junto); o gestor aprova', async () => {
    const m = await montar();
    const eu = sessao(COLAB);
    const pedido = {
      tipo: 'ajuste_ponto',
      vinculo: null,
      dia: '2026-10-20',
      ajuste: 'justificativa',
      marcacao: null,
      instante: null,
      movimento: 7,
      justificativa: 1,
      periodo: null,
      minutos: 60,
      observacao: OBS,
    } as const;
    const r = await m.servico.incluir(eu, pedido);
    expect(r.solicitacao!.ajustes.map((x) => x.situacao)).toEqual(['pendente']);
    expect(
      await codigo(
        m.servico.desistir(sessao('SINT.RH'), {
          solicitacao: r.id,
          versao: 0,
          motivo: 'Não fui eu quem pediu',
        }),
      ),
    ).toBe('solicitacao-desistencia-so-do-solicitante');
    const d = await m.servico.desistir(eu, { solicitacao: r.id, versao: 0, motivo: 'Lancei o dia errado' });
    expect(d.solicitacao).toMatchObject({ situacao: 'desistida', motivoDecisao: 'Lancei o dia errado' });
    expect(d.solicitacao!.ajustes.map((x) => x.situacao)).toEqual(['desistido']);
    // De novo, agora aprovado pelo gestor.
    const r2 = await m.servico.incluir(eu, pedido);
    const ok = await m.servico.decidir(sessao(), decidir(r2.id, 0, 'aprovar', null));
    expect(ok.solicitacao!.ajustes.map((x) => x.situacao)).toEqual(['aprovado']);
    // Dia futuro: o ajuste de ponto é de um dia vivido (domínio da solicitação).
    expect(await codigo(m.servico.incluir(eu, { ...pedido, dia: '2026-10-30' }))).toBe('ajuste-no-futuro');
  });

  it('alteração cadastral: a aprovação corrige o nome com o valor anterior na trilha', async () => {
    const m = await montar();
    const r = await m.servico.incluir(sessao(COLAB), {
      tipo: 'alteracao_cadastral',
      vinculo: null,
      campo: 'nome',
      valorNovo: 'COLABORADORA DO PONTO SINTETICA SILVA',
      observacao: 'Casei e mudei o sobrenome',
    });
    expect(r.solicitacao).toMatchObject({
      valorAnterior: 'COLABORADORA DO PONTO SINTETICA',
      valorNovo: 'COLABORADORA DO PONTO SINTETICA SILVA',
    });
    await m.servico.decidir(sessao(), decidir(r.id, 0, 'aprovar', null));
    const v = await m.pessoas.vinculo(sessao().porta, m.vinculo);
    expect(v?.nome).toBe('COLABORADORA DO PONTO SINTETICA SILVA');
    const corr = await m.pessoas.correcoes(sessao().porta, m.vinculo);
    expect(corr.at(-1)).toMatchObject({
      operacao: 'colaborador.corrigido',
      antes: { nome: 'COLABORADORA DO PONTO SINTETICA' },
      depois: { nome: 'COLABORADORA DO PONTO SINTETICA SILVA' },
    });
  });

  it('atestado: CID só com a permissão e o pedido; toda leitura vai à trilha de acesso; aviso do INSS', async () => {
    const m = await montar();
    const r = await m.servico.incluir(sessao(COLAB), {
      tipo: 'atestado',
      vinculo: null,
      inicio: '2026-10-20',
      fim: '2026-10-21',
      movimento: 7,
      atestado: {
        emitidoEm: '2026-10-20',
        dias: 20,
        cid: 'j11.1',
        emitente: 'Médica sintética',
        registroConselho: null,
        arquivo: null,
      },
      observacao: null,
    });
    expect(r.avisos).toEqual(['atestado-acima-de-15-dias']);
    expect(r.solicitacao!.temAtestado).toBe(true);
    // O gestor sem a permissão do CID: lê sem o CID; pedir o CID é 403.
    const gestor = sessao('SINT.GESTOR', semCid);
    const sem = await m.servico.atestado(gestor, r.id, { finalidade: 'Conferir os dias', verCid: false });
    expect(sem).toMatchObject({ cid: null, temCid: true, avisoInss: true, acessos: [] });
    expect(
      (await erro(m.servico.atestado(gestor, r.id, { finalidade: 'Ver o CID', verCid: true }))).getStatus(),
    ).toBe(403);
    // Sem aprovar e sem ser o próprio: 404 (não revela a solicitação).
    const estranho = sessao('SINT.ESTRANHO', () => false);
    expect(
      (
        await erro(m.servico.atestado(estranho, r.id, { finalidade: 'Curiosidade', verCid: false }))
      ).getStatus(),
    ).toBe(404);
    // Quem lê o ASO: vê o CID e a trilha (as duas leituras, a mais nova primeiro).
    const sesmt = sessao('SINT.SESMT');
    const com = await m.servico.atestado(sesmt, r.id, { finalidade: 'Nexo com o trabalho', verCid: true });
    expect(com.cid).toBe('J11.1');
    expect(com.acessos.map((x) => [x.acessadoPor, x.viuCid])).toEqual([
      ['SINT.SESMT', true],
      ['SINT.GESTOR', false],
    ]);
  });

  it('pedir só do próprio vínculo; quem não tem vínculo recebe 404', async () => {
    const m = await montar();
    expect(
      (
        await erro(m.servico.incluir(sessao('SINT.SEMVINCULO'), abono('2026-10-20', '2026-10-20')))
      ).getStatus(),
    ).toBe(404);
    expect(
      (
        await erro(
          m.servico.incluir(sessao(COLAB), {
            ...abono('2026-10-20', '2026-10-20'),
            vinculo: m.vinculo + 999,
          }),
        )
      ).getStatus(),
    ).toBe(404);
  });
});
