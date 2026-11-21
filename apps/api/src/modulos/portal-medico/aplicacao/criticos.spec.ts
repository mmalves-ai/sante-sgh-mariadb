// W0-10 (M5): o aviso de resultado crítico ao médico assistente externo. O aviso, o prazo e o escalonamento são os do
// valor crítico do hospital (a vigia do SADT); aqui: o portal mostra só os avisos dos pacientes com vínculo assistencial,
// a ciência do médico é a do prontuário (registro novo com a conduta; 409 se já houver; 404 fora da lista), e a
// notificação da conta sai uma vez por aviso, sem dado do paciente, pelo simulador (dev) ou fica registrada como
// 'desligado' com o motivo (trava de saídas: a Hal-AI do médico desligada fora do dev).
import type { AvisoCritico, WorklistMedico } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import type { PortaCirurgia } from '../../cirurgia/public-api.js';
import type { ServicoRepasse } from '../../repasse/public-api.js';
import type { PortaSadt, ServicoPortal } from '../../sadt/public-api.js';
import { PortaPortalMedicoMemoria } from '../porta-memoria.js';
import {
  CanalMedicoDesligado,
  CanalMedicoSimulador,
  MOTIVO_HALAI_MEDICO_DESLIGADA,
  canalMedicoDoAmbiente,
} from './canal.js';
import { type FontePacientesPortalMedico, type SessaoPortalM26, ServicoPortalMedico } from './servico.js';

const H = 'pc';
const ACESSO = 71;
const OUTRA = 72;
const MEU = 9001;
const ALHEIO = 9002;

const aviso = (id: number, paciente: number, ciencia: AvisoCritico['ciencia'] = null): AvisoCritico => ({
  id,
  exame: 500 + id,
  chave: `2026-11-18|1|1|1|1|K${id}|1`,
  paciente: {
    id: paciente,
    prontuario: paciente,
    nome: `PACIENTE SINTETICO ${paciente}`,
    sexo: null,
    idadeAnos: null,
    nascimento: null,
  } as AvisoCritico['paciente'],
  atendimento: '1',
  elemento: 'POTASSIO',
  valor: '7,1',
  origem: 'novo',
  liberadoEm: '2026-11-18T08:00:00',
  emitidoEm: '2026-11-18T08:00:05',
  segundosAteAviso: 5,
  prazoEm: '2026-11-18T08:30:05',
  nivel: 0,
  nivelRotulo: 'Médico responsável',
  comunicado: null,
  ciencia,
  situacao: ciencia ? 'comCiencia' : 'aguardandoCiencia',
});

function montar(o: { canal?: ServicoPortalMedico['canal'] } = {}) {
  const avisos: AvisoCritico[] = [
    aviso(1, MEU),
    aviso(2, ALHEIO),
    aviso(3, MEU, { usuario: 'X', em: '2026-11-18T09:00:00' }),
  ];
  const situacoes = new Map<number, string>([
    [ACESSO, 'ativo'],
    [OUTRA, 'ativo'],
  ]);
  const sadt = {
    destino: 'memoria',
    acessoPorId: async (_c: unknown, id: number) =>
      situacoes.has(id) ? { id, perfil: 'medicoExterno', situacao: situacoes.get(id) } : null,
    relogio: async () => ({ hoje: '2026-11-18', agora: '2026-11-18T10:00:00' }),
    avisos: async (_c: unknown, f: { pendentes?: boolean }) =>
      avisos.filter((a) => !f.pendentes || !a.ciencia),
    autocadastros: async () => [
      { id: ACESSO, origem: 'novo', situacao: 'aprovado', situacaoConta: 'ativo' },
      { id: OUTRA, origem: 'novo', situacao: 'aprovado', situacaoConta: 'ativo' },
    ],
  } as unknown as PortaSadt;
  const porta = new PortaPortalMedicoMemoria(async (_c, a) => situacoes.get(a) ?? null);
  const ciencias: { usuario: string; paciente: number; exame: number; conduta: string }[] = [];
  const fila = (pacientes: number[]): WorklistMedico =>
    ({
      pacientes: pacientes.map((paciente) => ({ paciente, pendencias: [] })),
      total: pacientes.length,
      teto: 100,
      limitado: false,
      semVinculo: false,
      geradaEm: '2026-11-18T10:00:00',
    }) as unknown as WorklistMedico;
  const fonte: FontePacientesPortalMedico = {
    // O profissional 6801 (registros 5001, 5101, 5102) tem o paciente MEU; os outros CBOs, nenhum.
    filaDoVinculo: async (_c, v) => fila(v.cbos.includes(5001) ? [MEU] : []),
    resultadosDoPaciente: async () => [],
    darCiencia: async (c, paciente, exame, conduta) => {
      ciencias.push({ usuario: c.usuarioLogin, paciente, exame, conduta });
      const a = avisos.find((x) => x.exame === exame)!;
      avisos[avisos.indexOf(a)] = { ...a, ciencia: { usuario: c.usuarioLogin, em: '2026-11-18T10:01:00' } };
      return 77;
    },
  };
  const sessoes = { sair: () => undefined } as unknown as ServicoPortal;
  const s = new ServicoPortalMedico(
    sessoes,
    sadt,
    porta,
    {} as PortaCirurgia,
    {} as ServicoRepasse,
    null,
    'rede',
  );
  s.pacientes = fonte;
  if (o.canal) s.canal = o.canal;
  return { s, porta, avisos, ciencias };
}

/** Contexto do núcleo de teste (memória: o estabelecimento pelo código). */
const ctxT = (rede: string, hospital: string) => ({
  cliente: '',
  estabelecimento: null,
  usuario: null,
  correlacao: 'teste',
  rede,
  hospital,
});

const sessao = (acesso = ACESSO) =>
  ({ hospital: H, perfil: 'medicoExterno', acesso, nome: 'M' }) as unknown as SessaoPortalM26;

async function ligar(porta: PortaPortalMedicoMemoria, acesso: number, profissional: number) {
  await porta.gravar(ctxT('rede', H), (g) => g.vincular({ acesso, profissional, por: 'T' }), null);
}

describe('W0-10 (M5): aviso de resultado crítico ao médico externo', () => {
  it('o portal mostra só os avisos dos pacientes com vínculo assistencial (o sem ciência primeiro) e a leitura vai à trilha', async () => {
    const { s, porta } = montar();
    expect(await s.criticos(sessao(), null)).toEqual({ vinculado: false, avisos: [], pendentes: 0 });
    await ligar(porta, ACESSO, 6801);
    const r = await s.criticos(sessao(), null);
    expect(r.avisos.map((a) => [a.aviso, a.paciente, a.situacao])).toEqual([
      [1, MEU, 'aguardandoCiencia'],
      [3, MEU, 'comCiencia'],
    ]);
    expect(r.pendentes).toBe(1);
    expect(porta.trilhas.at(-1)).toMatchObject({
      evento: 'portal.medico.criticosLidos',
      usuario: `SGH.PORTAL.M${ACESSO}`,
    });
  });

  it('a ciência é a do prontuário (com a conduta, pelo usuário da conta); 409 se já houver; 404 fora da lista', async () => {
    const { s, porta, ciencias } = montar();
    await ligar(porta, ACESSO, 6801);
    const codigo = async (f: () => Promise<unknown>) =>
      f().then(
        () => null,
        (e: { getStatus(): number; extras: { codigo?: string } }) => [e.getStatus(), e.extras.codigo],
      );
    expect(await codigo(() => s.cienciaCritico(sessao(), null, 2, { conduta: 'repetir o exame' }))).toEqual([
      404,
      'aviso-fora-da-lista',
    ]);
    expect(await codigo(() => s.cienciaCritico(sessao(), null, 3, { conduta: 'repetir o exame' }))).toEqual([
      409,
      'ciencia-registrada',
    ]);
    const r = await s.cienciaCritico(sessao(), null, 1, { conduta: 'repetir o exame e ligar' });
    expect(r).toMatchObject({ ok: true, id: 77 });
    expect(ciencias).toEqual([
      { usuario: `SGH.PORTAL.M${ACESSO}`, paciente: MEU, exame: 501, conduta: 'repetir o exame e ligar' },
    ]);
    expect(porta.trilhas.at(-1)).toMatchObject({
      evento: 'portal.medico.criticoCiente',
      tabelaAlvo: 'aviso_valor_critico',
      idAlvo: '1',
      chaveNaturalAlvo: 'ciencia=77',
      idPaciente: MEU,
    });
    // Com a ciência, o aviso não volta a pedir ciência (e a vigia do SADT para o escalonamento).
    expect((await s.criticos(sessao(), null)).pendentes).toBe(0);
  });

  it('a notificação sai uma vez por aviso e conta, só ao médico com vínculo, pelo simulador e sem dado do paciente', async () => {
    const simulador = new CanalMedicoSimulador();
    const { s, porta } = montar({ canal: simulador });
    await ligar(porta, ACESSO, 6801);
    await ligar(porta, OUTRA, 6802);
    expect(await s.notificarCriticos(H)).toEqual({ contas: 1, notificados: 1 });
    // O segundo ciclo não repete.
    expect(await s.notificarCriticos(H)).toEqual({ contas: 0, notificados: 0 });
    const caixa = simulador.mensagens(H);
    expect(caixa).toHaveLength(1);
    expect(caixa[0]).toMatchObject({
      acesso: ACESSO,
      tipo: 'resultado-critico',
      destino: `conta M${ACESSO}`,
      link: '/medico-externo/criticos',
    });
    expect(JSON.stringify(caixa[0])).not.toMatch(/PACIENTE|POTASSIO|7,1/);
    expect(await porta.notificacoesCritico(ctxT('rede', H), ACESSO)).toEqual([
      { aviso: 1, envio: 'simulador', motivo: null, em: expect.any(String) },
    ]);
    expect(await porta.notificacoesCritico(ctxT('rede', H), OUTRA)).toEqual([]);
    expect(porta.trilhas.filter((t) => t.evento === 'portal.medico.criticoNotificado')).toEqual([
      expect.objectContaining({ idAlvo: '1', tabelaAlvo: 'aviso_valor_critico', idPaciente: MEU }),
    ]);
    const r = await s.criticos(sessao(), null);
    expect(r.avisos[0]?.notificacao).toMatchObject({ envio: 'simulador' });
  });

  it('trava de saídas: fora do dev/ci o canal é o desligado; nada sai e a notificação guarda o motivo', async () => {
    expect(canalMedicoDoAmbiente('dev')).toBeInstanceOf(CanalMedicoSimulador);
    expect(canalMedicoDoAmbiente('ci')).toBeInstanceOf(CanalMedicoSimulador);
    expect(canalMedicoDoAmbiente('producao')).toBeInstanceOf(CanalMedicoDesligado);
    const desligado = new CanalMedicoDesligado();
    let enviou = 0;
    const espiao: ServicoPortalMedico['canal'] = {
      disponivel: () => desligado.disponivel(),
      enviar: () => {
        enviou++;
        return Promise.reject(new Error('não deveria enviar'));
      },
    };
    const { s, porta } = montar({ canal: espiao });
    await ligar(porta, ACESSO, 6801);
    expect(await s.notificarCriticos(H)).toEqual({ contas: 1, notificados: 1 });
    expect(enviou).toBe(0);
    expect(await porta.notificacoesCritico(ctxT('rede', H), ACESSO)).toEqual([
      { aviso: 1, envio: 'desligado', motivo: MOTIVO_HALAI_MEDICO_DESLIGADA, em: expect.any(String) },
    ]);
  });

  it('sem avisos pendentes ou sem a fila (503 nas telas), o ciclo não faz nada', async () => {
    const { s, avisos } = montar();
    avisos.splice(0, avisos.length);
    expect(await s.notificarCriticos(H)).toEqual({ contas: 0, notificados: 0 });
    s.pacientes = null;
    expect(await s.notificarCriticos(H)).toEqual({ contas: 0, notificados: 0 });
  });
});
