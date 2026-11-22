// Acesso cruzado ao prontuário entre os estabelecimentos da rede (M57, etapa 2; regras 6, 7 e 12) sobre a porta do MPI
// em memória (dois bancos SINTÉTICOS) e um serviço de documentos simulado: a regra da DP-42 desligada no outro
// estabelecimento recusa antes de qualquer leitura e de qualquer trilha; o estabelecimento fora da rede ou o da própria
// sessão, recusados; sem vínculo ativo, 404; ligada, a trilha vai ao banco ONDE O REGISTRO ESTÁ antes da linha do
// tempo (sem trilha, sem dado: 503); só a linha do tempo volta (nenhum documento).
import { describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { ServicoMpiRede, type SessaoRede } from '../rede/aplicacao/servico.js';
import { PortaRedeMemoria } from '../rede/porta-memoria.js';
import { AcessoProntuarioRede } from './acesso-rede.js';

const REDE = 'rede-teste';
const PEDIDO = { motivo: 'assistencia' as const, justificativa: 'Paciente em atendimento aqui', pagina: 1 };
const SA = {
  rede: REDE,
  hospital: 'pc',
  porta: {
    cliente: 'teste',
    estabelecimento: null,
    usuario: null,
    correlacao: 'teste',
    rede: REDE,
    hospital: 'pc',
  },
  login: 'SINT.MEDICO',
  estacao: 'TESTE',
  correlacao: 'teste',
};

async function montar(
  ligadas: Record<string, boolean> = { sx: true },
  cpfsDeLogin?: Record<string, Record<string, string | null>>,
) {
  const porta = new PortaRedeMemoria({
    rede: REDE,
    estabelecimentos: [
      { codigo: 'pc', nome: 'Estabelecimento sintético A' },
      { codigo: 'sx', nome: 'Estabelecimento sintético B' },
    ],
    ...(cpfsDeLogin ? { cpfsDeLogin } : {}),
  });
  const s: SessaoRede = {
    rede: REDE,
    hospital: 'pc',
    login: 'SINT.GESTOR',
    trilha: (evento, operacao, alvo) => ({
      estabelecimento: null,
      usuario: null,
      acao: 'operacao',
      entidade: 'suspeita_duplicidade',
      entidadeId: null,
      dadosDepois: {
        evento,
        recurso: 'rede.mpi',
        operacao,
        chave: alvo.chave,
        login: 'SINT.GESTOR',
        estabelecimento: 'pc',
      },
      correlacao: 'teste',
    }),
  };
  await new ServicoMpiRede(porta).ciclo(s); // pc:1 ↔ sx:101 automático
  const trilha = new RegistradorTrilhaMemoria();
  const ordem: string[] = [];
  const lidos: { hospital: string; paciente: number }[] = [];
  const acesso = new AcessoProntuarioRede({
    rede: porta,
    documentos: {
      exigirPaciente: async (c, p) => {
        ordem.push(`paciente:${c.hospital}`);
        return { id: p } as never;
      },
      linhaTempo: async (c, p) => {
        ordem.push(`linha:${c.hospital}:${trilha.eventos.length}`);
        lidos.push({ hospital: c.hospital, paciente: p });
        return {
          eventos: [
            {
              chave: 'evo:1',
              tipo: 'evolucao',
              quando: '2026-09-14T10:00:00.000Z',
              titulo: 'Evolução médica',
              detalhe: null,
              profissional: 'PROFISSIONAL SINTETICO',
              situacao: null,
              suspenso: false,
              sigilo: false,
              documento: 99,
            },
          ],
          pagina: 1,
          temMais: false,
        } as never;
      },
    },
    trilha,
    ligadaNoEstabelecimento: async (_r, h) => ligadas[h] ?? false,
  });
  return { porta, s, trilha, ordem, lidos, acesso };
}

const codigo = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) =>
      e instanceof ErroProblema ? `${e.getStatus()}:${String(e.extras.codigo ?? e.tipo)}` : 'outro',
  );

describe('acesso cruzado ao prontuário (regras 6 e 7)', () => {
  it('regra da DP-42 desligada no outro estabelecimento: 403 antes de ler e de registrar', async () => {
    const m = await montar({ sx: false });
    expect(await codigo(m.acesso.abrir(SA, 1, 'sx', PEDIDO, null))).toBe('403:recurso-desligado');
    expect(m.ordem).toEqual([]);
    expect(m.trilha.eventos).toEqual([]);
  });

  it('fora da rede, o próprio estabelecimento, outra rede e código inválido: recusados sem leitura', async () => {
    const m = await montar();
    expect(await codigo(m.acesso.abrir(SA, 1, 'zz', PEDIDO, null))).toBe('403:fora-da-rede');
    expect(await codigo(m.acesso.abrir(SA, 1, 'pc', PEDIDO, null))).toBe('403:fora-da-rede');
    expect(await codigo(m.acesso.abrir({ ...SA, rede: 'outra' }, 1, 'sx', PEDIDO, null))).toBe(
      '403:fora-da-rede',
    );
    expect(await codigo(m.acesso.abrir(SA, 1, 'SX;--', PEDIDO, null))).toBe('403:fora-da-rede');
    expect(m.ordem).toEqual([]);
  });

  it('sem vínculo ativo com o outro estabelecimento: 404', async () => {
    const m = await montar();
    expect(await codigo(m.acesso.abrir(SA, 2, 'sx', PEDIDO, null))).toBe('404:sem-vinculo-rede');
    expect(m.lidos).toEqual([]);
  });

  it('ligada: a trilha no banco do registro ANTES da linha do tempo; só a linha do tempo volta', async () => {
    const m = await montar();
    const r = await m.acesso.abrir(SA, 1, 'sx', PEDIDO, null);
    expect(r).toMatchObject({
      estabelecimento: 'sx',
      estabelecimentoNome: 'Estabelecimento sintético B',
      idRemoto: 101,
      pagina: 1,
      temMais: false,
    });
    expect(r.eventos).toHaveLength(1);
    expect(Object.keys(r.eventos[0]!)).not.toContain('documento');
    expect(m.lidos).toEqual([{ hospital: 'sx', paciente: 101 }]);
    // A trilha já tinha 1 evento quando a linha do tempo foi lida, e no banco do outro estabelecimento.
    expect(m.ordem).toEqual(['paciente:sx', 'linha:sx:1']);
    expect(m.trilha.eventos).toHaveLength(1);
    expect(m.trilha.eventos[0]).toMatchObject({
      evento: 'pep.prontuarioRede.lido',
      hospital: 'sx',
      usuario: 'SINT.MEDICO',
      paciente: 101,
      legado: true,
      chaveNaturalAlvo: 'rede;de:pc;por:SINT.MEDICO;motivo:assistencia;parte:linha-do-tempo',
    });
    // A justificativa (texto livre) não vai à trilha do outro banco.
    expect(JSON.stringify(m.trilha.eventos)).not.toContain(PEDIDO.justificativa);
  });

  it('sem trilha no banco do registro, sem dado (503)', async () => {
    const m = await montar();
    m.trilha.falhar = true;
    expect(await codigo(m.acesso.abrir(SA, 1, 'sx', PEDIDO, null))).toBe('503:trilha-indisponivel');
    expect(m.lidos).toEqual([]);
  });

  it('depois de desfeito o vínculo, 404', async () => {
    const m = await montar();
    await new ServicoMpiRede(m.porta).desfazer(m.s, 'pc:1|sx:101', {
      justificativa: 'Teste',
      reabrir: false,
    });
    expect(await codigo(m.acesso.abrir(SA, 1, 'sx', PEDIDO, null))).toBe('404:sem-vinculo-rede');
  });

  it('o mesmo login é OUTRA pessoa no outro banco (CPF diferente, sem CPF ou inexistente): a trilha de lá sem o nome', async () => {
    const casos: Record<string, string | null>[] = [
      { 'SINT.MEDICO': '99000000002' },
      { 'SINT.MEDICO': null },
      {},
    ];
    for (const la of casos) {
      const m = await montar({ sx: true }, { pc: { 'SINT.MEDICO': '99000000001' }, sx: la });
      await m.acesso.abrir(SA, 1, 'sx', PEDIDO, null);
      expect(m.trilha.eventos).toHaveLength(1);
      // Nada na trilha do legado de lá em nome de quem tem o mesmo login; só a própria, como (desconhecido), com o
      // estabelecimento de origem e o login na chave natural.
      expect(m.trilha.eventos[0]).toMatchObject({
        evento: 'pep.prontuarioRede.lido',
        hospital: 'sx',
        usuario: '(desconhecido)',
        usuarioNaoConfirmado: true,
        legado: false,
        chaveNaturalAlvo: 'rede;de:pc;por:SINT.MEDICO;motivo:assistencia;parte:linha-do-tempo',
      });
    }
  });

  it('o mesmo CPF nos dois bancos prova a mesma pessoa: a trilha dupla de lá em nome do login', async () => {
    const cpf = { 'SINT.MEDICO': '99000000001' };
    const m = await montar({ sx: true }, { pc: cpf, sx: cpf });
    await m.acesso.abrir(SA, 1, 'sx', PEDIDO, null);
    expect(m.trilha.eventos[0]).toMatchObject({ usuario: 'SINT.MEDICO', legado: true });
    expect(m.trilha.eventos[0]?.usuarioNaoConfirmado).toBeUndefined();
  });
});
