// Porta da recepção sobre o núcleo do legado (M19): leituras READ ONLY pelos repositórios de @sgh/legado; gravações
// pelo EXECUTOR (receitas recepcao.*, com a trilha na mesma transação); as gravações só do novo (fila por gerador e
// dispositivos) em transação SGH_ com a SGH_TRILHA junto. Fora de dev/ci, sem o núcleo, a porta indisponível
// responde 503 (falha fechada).
import {
  agendadosDoDia,
  alterarDispositivoRecepcao,
  assinarTermo,
  assinaturasTermoDoPaciente,
  excluirModeloTermo,
  incluirModeloTermo,
  listarModelosTermo,
  opcoesConsentimento,
  novaVersaoModeloTermo,
  revogarTermo,
  situacaoModeloTermo,
  criarDispositivo,
  dispositivoDoToken,
  type Executor,
  type FonteCatalogo,
  gravarFilaCfg,
  gravarTrilha,
  guichesEmUso,
  indicadoresRecepcao,
  type Leitor,
  listarDispositivos,
  listarRecepcoes,
  marcarChamadaDeFora,
  marcarUsoDispositivo,
  type MetricasExecutor,
  type NucleoLegado,
  operacao,
  pacientesDasSenhas,
  paineisTvLegado,
  parametrosRecepcao,
  relogioRecepcao,
  renovarDispositivo,
  revogarDispositivo,
  conferirDispositivo,
  senhaPorId,
  senhasAFrente,
  senhasDoDia,
  USUARIO_VIGIA_RECEPCAO,
  usuariosTecnicosDoTotem,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoRecepcao, PortaRecepcao } from './porta.js';

export function portaRecepcaoLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  codigos: readonly string[],
  metricas?: MetricasExecutor,
  executorPronto?: Executor,
  aoConfirmar?: (hospital: string, eventos: readonly string[]) => void,
): PortaRecepcao {
  const executor =
    executorPronto ??
    nucleo.criarExecutor({
      catalogo,
      ...(metricas ? { metricas } : {}),
      ...(aoConfirmar ? { aoConfirmar } : {}),
    });
  const ctx = (c: ContextoRecepcao) => ({ rede: c.rede, hospital: c.hospital, traceId: 'recepcao' });
  const ler = <T>(c: ContextoRecepcao, fn: (l: Leitor) => Promise<T>) => nucleo.lerSomente(ctx(c), fn);
  return {
    destino: 'legado',
    podeGravar: (c, op, usuarioLegado) =>
      executor.liberacao(operacao(op), { rede: c.rede, hospital: c.hospital, usuarioLegado }),
    async executar(c, op, entrada, octx) {
      const r = await executor.executar(operacao(op), c.hospital, entrada, octx);
      return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
    },
    gravarSgh: (c, trilha, fn) =>
      nucleo.gravarSgh(ctx(c), async (e) => {
        const r = await fn({
          gravarFilaCfg: (x) => gravarFilaCfg(e, { hospital: c.hospital, ...x }),
          criarDispositivo: (x) => criarDispositivo(e, { hospital: c.hospital, ...x }),
          renovarDispositivo: (x) => renovarDispositivo(e, { hospital: c.hospital, ...x }),
          alterarDispositivo: (x) => alterarDispositivoRecepcao(e, { hospital: c.hospital, ...x }),
          revogarDispositivo: (x) => revogarDispositivo(e, { hospital: c.hospital, ...x }),
          conferirDispositivo: (x) => conferirDispositivo(e, { hospital: c.hospital, ...x }),
          incluirModeloTermo: (x) => incluirModeloTermo(e, { hospital: c.hospital, ...x }),
          novaVersaoModeloTermo: (x) => novaVersaoModeloTermo(e, { hospital: c.hospital, ...x }),
          situacaoModeloTermo: (x) => situacaoModeloTermo(e, { hospital: c.hospital, ...x }),
          excluirModeloTermo: (x) => excluirModeloTermo(e, { hospital: c.hospital, ...x }),
          assinarTermo: (x) => assinarTermo(e, { hospital: c.hospital, ...x }),
          revogarTermo: (x) => revogarTermo(e, { hospital: c.hospital, ...x }),
        });
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      }),
    marcarUsoDispositivo: (c, id) =>
      nucleo.gravarSgh(ctx(c), (e) => marcarUsoDispositivo(e, { hospital: c.hospital, id })),
    registrarChamadasDeFora: (c, chamadas) =>
      nucleo.gravarSgh(ctx(c), async (e) => {
        const gravadas: number[] = [];
        for (const x of chamadas.slice(0, 50))
          if (await marcarChamadaDeFora(e, { hospital: c.hospital, ...x })) gravadas.push(x.senha);
        if (gravadas.length > 0)
          await gravarTrilha(e, {
            rede: c.rede,
            hospital: c.hospital,
            usuario: USUARIO_VIGIA_RECEPCAO,
            evento: 'recepcao.senha.chamada',
            recurso: 'recepcao.senha',
            operacao: 'recepcao.chamadaDeFora',
            tabelaAlvo: 'SGH_REC_SENHA_EXT',
            idAlvo: String(gravadas[0]),
            chaveNaturalAlvo: null,
            resultado: 'sucesso',
            estacao: 'vigia',
            correlacao: `vigia-senhas-${Date.now().toString(36)}`,
            origem: 'vigia',
            diferenca: `chamadas de fora: ${gravadas.join(',')}`.slice(0, 200),
          });
        return gravadas.length;
      }),
    relogio: (c) => ler(c, (l) => relogioRecepcao(l)),
    recepcoes: (c) => ler(c, (l) => listarRecepcoes(l, c.hospital)),
    guichesEmUso: (c) => ler(c, (l) => guichesEmUso(l)),
    senhasDoDia: (c, f) => ler(c, (l) => senhasDoDia(l, c.hospital, f)),
    senha: (c, id) => ler(c, (l) => senhaPorId(l, c.hospital, id)),
    aFrente: (c, id) => ler(c, (l) => senhasAFrente(l, id)),
    agendados: (c, f) => ler(c, (l) => agendadosDoDia(l, f)),
    pacientesDasSenhas: (c, ids) => ler(c, (l) => pacientesDasSenhas(l, ids)),
    // A marca "sigiloso" do cadastro do paciente é do W1-02 (alertas do paciente, parte 9, ainda fora do fase0): até
    // ela chegar, nenhum prontuário é sigiloso aqui; o serviço já mascara quem vier nesta lista (D-W104-13).
    sigilosos: () => Promise.resolve(new Set<number>()),
    // A foto do paciente (captura e armazenamento) é do W1-02 (parte 8, ainda fora do fase0): até ela chegar, nenhum
    // paciente tem foto aqui e o guichê mostra o espaço vazio (D-W104-14).
    fotos: () => Promise.resolve(new Map<number, string>()),
    parametros: (c) => ler(c, (l) => parametrosRecepcao(l)),
    paineisTv: (c) => ler(c, (l) => paineisTvLegado(l)),
    usuariosTecnicos: (c) => ler(c, (l) => usuariosTecnicosDoTotem(l)),
    indicadores: (c, de, ate, rec) => ler(c, (l) => indicadoresRecepcao(l, c.hospital, de, ate, rec)),
    dispositivos: (c) => ler(c, (l) => listarDispositivos(l, c.hospital)),
    modelosTermo: (c) => ler(c, (l) => listarModelosTermo(l, c.hospital)),
    termosDoPaciente: (c, p) => ler(c, (l) => assinaturasTermoDoPaciente(l, c.hospital, p)),
    signatariosTermo: (c) => ler(c, async (l) => (await opcoesConsentimento(l)).signatarios),
    async dispositivoDoToken(token) {
      for (const hospital of codigos) {
        try {
          const d = await nucleo.lerSomente({ rede: nucleo.rede, hospital, traceId: 'dispositivo' }, (l) =>
            dispositivoDoToken(l, token),
          );
          if (d) return d;
        } catch {
          // Estabelecimento fora do ar: o token pode ser de outro; segue.
        }
      }
      return null;
    },
  };
}

const METODOS_DA_PORTA: ReadonlySet<string> = new Set([
  'executar',
  'gravarSgh',
  'marcarUsoDispositivo',
  'registrarChamadasDeFora',
  'relogio',
  'recepcoes',
  'guichesEmUso',
  'senhasDoDia',
  'senha',
  'aFrente',
  'agendados',
  'pacientesDasSenhas',
  'sigilosos',
  'fotos',
  'parametros',
  'paineisTv',
  'usuariosTecnicos',
  'indicadores',
  'dispositivos',
  'modelosTermo',
  'termosDoPaciente',
  'signatariosTermo',
  'dispositivoDoToken',
]);

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaRecepcaoIndisponivel(): PortaRecepcao {
  const recusa = (): Promise<never> =>
    Promise.reject(
      new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'O banco do estabelecimento não está configurado: nada foi lido nem gravado.',
      ),
    );
  const p = new Proxy(
    {},
    {
      get: (_t, chave) => {
        if (chave === 'destino') return 'indisponivel';
        if (chave === 'podeGravar')
          return async () => ({
            pode: false,
            codigo: 'indisponivel',
            motivo: 'O banco do estabelecimento não está configurado: nada é gravado.',
          });
        return typeof chave === 'string' && METODOS_DA_PORTA.has(chave) ? recusa : undefined;
      },
    },
  );
  return p as PortaRecepcao;
}
