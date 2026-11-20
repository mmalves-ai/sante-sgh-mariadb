// Porta do portal do médico externo sobre o núcleo do legado (M50, etapa 3): leituras READ ONLY (o vínculo da conta, o
// profissional e os registros dele pela PK, a sugestão pelo número e pela UF do conselho, a busca pelo nome); gravações
// numa transação SGH_ com a SGH_TRILHA junto (só SGH_SADT_PORTAL_ACESSO). `portaPortalMedicoNaTransacao`: a mesma porta
// sobre UMA transação aberta (integração na cópia, desfeita).
import {
  atosContaMedico,
  buscarProfissionaisCorpoClinico,
  cancelarTrocaEmailMedico,
  confirmarTrocaEmailMedico,
  desvincularProfissionalMedicoExterno,
  donosDosCodigos,
  type Escritor,
  gravarTrilha,
  type Leitor,
  type NucleoLegado,
  notificacoesCriticoMedico,
  pedirTrocaEmailMedico,
  profissionaisCorpoClinico,
  profissionaisPorConselho,
  profissionaisPorConselhos,
  profissionalCorpoClinico,
  loginDoProfissionalMedicoExterno,
  registrarAtoContaMedico,
  registrarNotificacaoCriticoMedico,
  trocaEmailMedicoPendente,
  trocaEmailMedicoPorToken,
  trocarSenhaContaMedico,
  vincularProfissionalMedicoExterno,
  vinculosMedicoExterno,
} from '@sgh/legado';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type ContextoPortalMedico,
  type GravadorPortalMedico,
  METODOS_PORTA_PORTAL_MEDICO,
  type PortaPortalMedico,
} from './porta.js';

const gravador = (e: Escritor, c: ContextoPortalMedico): GravadorPortalMedico => ({
  vincular: (x) => vincularProfissionalMedicoExterno(e, { hospital: c.hospital, ...x }),
  desvincular: (x) => desvincularProfissionalMedicoExterno(e, { hospital: c.hospital, ...x }),
  atoConta: (x) => registrarAtoContaMedico(e, { hospital: c.hospital, ...x }),
  trocarSenha: (x) => trocarSenhaContaMedico(e, { hospital: c.hospital, ...x }),
  pedirTrocaEmail: (x) => pedirTrocaEmailMedico(e, { hospital: c.hospital, ...x }),
  cancelarTrocaEmail: (troca) => cancelarTrocaEmailMedico(e, c.hospital, troca),
  confirmarTrocaEmail: (x) => confirmarTrocaEmailMedico(e, { hospital: c.hospital, ...x }),
  notificarCritico: (x) => registrarNotificacaoCriticoMedico(e, { hospital: c.hospital, ...x }),
});

type Ler = <T>(c: ContextoPortalMedico, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaPortalMedico, 'destino' | 'gravar' | 'registrarLeitura'> {
  return {
    vinculos: (c, ids) => ler(c, (l) => vinculosMedicoExterno(l, c.hospital, ids)),
    profissional: (c, id) => ler(c, (l) => profissionalCorpoClinico(l, id)),
    profissionais: (c, ids) => ler(c, (l) => profissionaisCorpoClinico(l, ids)),
    donosDosCodigos: (c, codigos) => ler(c, (l) => donosDosCodigos(l, codigos)),
    sugestoes: (c, uf, numero) => ler(c, (l) => profissionaisPorConselho(l, uf, numero)),
    sugestoesEmLote: (c, pares) => ler(c, (l) => profissionaisPorConselhos(l, pares)),
    buscarProfissionais: (c, texto) => ler(c, (l) => buscarProfissionaisCorpoClinico(l, texto)),
    atosConta: (c, acesso) => ler(c, (l) => atosContaMedico(l, c.hospital, acesso)),
    trocaEmailPendente: (c, acesso) => ler(c, (l) => trocaEmailMedicoPendente(l, c.hospital, acesso)),
    trocaEmailPorToken: (c, t) => ler(c, (l) => trocaEmailMedicoPorToken(l, c.hospital, t)),
    notificacoesCritico: (c, acesso) => ler(c, (l) => notificacoesCriticoMedico(l, c.hospital, acesso)),
    loginDoProfissional: (c, id) => ler(c, (l) => loginDoProfissionalMedicoExterno(l, id)),
  };
}

export function portaPortalMedicoLegado(nucleo: NucleoLegado): PortaPortalMedico {
  const ctx = (c: ContextoPortalMedico) => ({ rede: c.rede, hospital: c.hospital, traceId: 'portal-medico' });
  return {
    destino: 'legado',
    gravar: (c, fn, trilha) =>
      nucleo.gravarSgh(ctx(c), async (e) => {
        const r = await fn(gravador(e, c));
        if (trilha) await gravarTrilha(e, trilha);
        return r;
      }),
    registrarLeitura: (c, trilha) =>
      nucleo.gravarSgh(ctx(c), async (e) => {
        await gravarTrilha(e, trilha);
      }),
    ...leituras((c, fn) => nucleo.lerSomente(ctx(c), fn)),
  };
}

export function portaPortalMedicoNaTransacao(e: Escritor): PortaPortalMedico {
  return {
    destino: 'legado',
    gravar: async (c, fn, trilha) => {
      const r = await fn(gravador(e, c));
      if (trilha) await gravarTrilha(e, trilha);
      return r;
    },
    registrarLeitura: async (_c, trilha) => {
      await gravarTrilha(e, trilha);
    },
    ...leituras((_c, fn) => fn(e)),
  };
}

export function portaPortalMedicoIndisponivel(): PortaPortalMedico {
  return portaIndisponivel<PortaPortalMedico>(METODOS_PORTA_PORTAL_MEDICO);
}
