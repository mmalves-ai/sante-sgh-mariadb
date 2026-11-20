// Porta do painel de migração gradual sobre o núcleo do legado (M37): leituras em transação READ ONLY no banco do
// estabelecimento do contexto; gravações só em SGH_ (o escritor `somenteSgh` do núcleo) com a SGH_TRILHA na mesma
// transação; o lote como unidade (as chaves do M08 na mesma transação). `portaCoexistenciaNaTransacao`: a mesma
// porta sobre UMA transação aberta (os testes de integração na cópia, sempre desfeita).
import {
  abrirChamado,
  aplicarLoteCoexistencia,
  coletar,
  feriadosDoPeriodo,
  contarChamados,
  contarPublicoPorGrupo,
  contarUsoDoDia,
  type Escritor,
  gravarOutbox,
  gravarSetorCoex,
  gravarTrilha,
  gravarUsoDia,
  gravarItensLigar,
  gravarItemDesligamento,
  contarDependenciasTrilhaCoex,
  estornarConclusaoTreino,
  gravarEventoCrud,
  gravarRetrato,
  lerConclusaoParaEstorno,
  lerVersaoTrilhaCoex,
  retirarVersaoTrilhaCoex,
  gravarVersaoRegistroCoex,
  lerVersoesRegistroCoex,
  retratarLinha,
  voltarItemDesligamentoPendente,
  voltarItemLigarPendente,
  lerContasTecnicasBanco,
  lerFuncoesBanco,
  lerItensDesligamento,
  lerPlataformaBanco,
  lerCatalogoRetrocompatibilidade,
  lerSessoesOutroSistema,
  lerItensLigar,
  lerChecagemAgregada,
  lerHigienizacaoAgregada,
  lerRegistrosPorDia,
  lerChamados,
  lerChavesLiberacao,
  lerConclusoesTreino,
  lerConducoes,
  lerConexoesOutroSistema,
  lerLotesCoex,
  lerOpcoesDosGrupos,
  lerPessoasDoEstabelecimento,
  lerRetratosConexao,
  lerSetoresCoex,
  lerTrilhasCoex,
  lerUltimoUsoNovo,
  lerUsoDia,
  contarUsuariosFim,
  lerCompetenciaPeloNovo,
  lerGruposAtivos,
  lerSerieConexoesOutro,
  lerUltimaCompetenciaFechada,
  lerUsuariosParaRevisao,
  type Leitor,
  MEDIDAS_USO,
  type NucleoLegado,
  publicarTrilhaCoex,
  recolherLoteCoexistencia,
  registrarConclusoesTreino,
  relogioDoBanco,
  triarChamado,
} from '@sgh/legado';
import { reverterLote } from '@sgh/dominio-config';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type CargaAgora,
  type ContextoCoex,
  type GravadorCoex,
  METODOS_PORTA_COEXISTENCIA,
  type PortaCoexistencia,
} from './porta.js';

/** Tipo do evento da outbox do aviso do chamado (dado pessoal: o encarregado; S1: o plantão). */
export const EVENTO_ALERTA_CHAMADO = 'alerta-chamado';

/**
 * Os eventos da outbox do aviso de um chamado: um por motivo verdadeiro (dado pessoal: o encarregado; S1: o plantão),
 * com chaves distintas, para que o S1 com dado pessoal chegue aos dois destinos (D-AVISO-37). Só códigos.
 */
export function eventosAlertaChamado(
  c: ContextoCoex,
  id: string,
  severidade: string,
  alertar: { readonly encarregado: boolean; readonly s1: boolean },
): { rede: string; hospital: string; tipo: string; chave: string; carga: Record<string, string> }[] {
  const motivos = [...(alertar.encarregado ? ['dado-pessoal'] : []), ...(alertar.s1 ? ['s1'] : [])];
  return motivos.map((motivo) => ({
    rede: c.rede,
    hospital: c.hospital,
    tipo: EVENTO_ALERTA_CHAMADO,
    chave: `chamado:${c.hospital}:${id}:${motivo}`,
    carga: { idChamado: id, severidade, motivo },
  }));
}

function gravador(e: Escritor, c: ContextoCoex): GravadorCoex {
  return {
    gravarSetor: (s, u) => gravarSetorCoex(e, c.hospital, s, u),
    publicarTrilha: (t, u) => publicarTrilhaCoex(e, c.hospital, t, u),
    registrarConclusoes: (x, u) => registrarConclusoesTreino(e, c.hospital, x, u),
    async abrirChamado(x, alertar) {
      const id = await abrirChamado(e, c.hospital, x);
      // Os avisos saem pela outbox na MESMA transação (o relay publica na fila de e-mail): só códigos.
      for (const ev of eventosAlertaChamado(c, id, x.severidade, alertar)) await gravarOutbox(e, ev);
      return id;
    },
    triarChamado: (id, t, u) => triarChamado(e, c.hospital, id, t, u),
    gravarUsoDia: (l) => gravarUsoDia(e, c.hospital, l),
    gravarItensLigar: (setor, itens, u) => gravarItensLigar(e, c.hospital, setor, itens, u),
    gravarItemDesligamento: (i, u) => gravarItemDesligamento(e, c.hospital, i, u),
    voltarItemLigarPendente: (setor, item, u) => voltarItemLigarPendente(e, c.hospital, setor, item, u),
    voltarItemDesligamentoPendente: (item, u) => voltarItemDesligamentoPendente(e, c.hospital, item, u),
    lerConclusaoParaEstorno: (id) => lerConclusaoParaEstorno(e, c.hospital, id),
    estornarConclusao: (id, motivo, u) => estornarConclusaoTreino(e, c.hospital, id, motivo, u),
    lerVersaoTrilha: (v) => lerVersaoTrilhaCoex(e, c.hospital, v.papel, v.onda, v.versao),
    contarVinculosTrilha: (v) => contarDependenciasTrilhaCoex(e, c.hospital, v),
    async retratarVersaoTrilha(v, quem) {
      const r = await retratarLinha(
        e,
        'SGH_CFG_COEX_TRILHA',
        'HOSPITAL = ? AND PAPEL = ? AND ONDA = ? AND VERSAO = ?',
        [c.hospital, v.papel, v.onda, v.versao],
        `${c.hospital}|${v.papel}|${v.onda}|${v.versao}`,
      );
      if (!r) throw new Error('SGH_CFG_COEX_TRILHA: versão sem linha para o retrato.');
      await gravarRetrato(e, r, { hospital: c.hospital, ...quem });
    },
    retirarVersaoTrilha: (v, modo) => retirarVersaoTrilhaCoex(e, c.hospital, v, modo),
    registrarEvento: (ev) => gravarEventoCrud(e, { hospital: c.hospital, ...ev }),
    gravarVersaoRegistro: (tipo, conteudo, motivo, u) =>
      gravarVersaoRegistroCoex(e, c.hospital, tipo, conteudo, motivo, u),
  };
}

type Ler = <T>(c: ContextoCoex, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(
  ler: Ler,
  nucleo: NucleoLegado | null,
): Omit<PortaCoexistencia, 'destino' | 'gravarSgh' | 'aplicarLote' | 'recolherLote'> {
  return {
    relogio: (c) =>
      ler(c, async (l) => {
        const agora = await relogioDoBanco(l);
        return { agora, hoje: agora.toISOString().slice(0, 10) };
      }),
    pessoas: (c) => ler(c, (l) => lerPessoasDoEstabelecimento(l)),
    conexoesOutro: (c) => ler(c, (l) => lerConexoesOutroSistema(l)),
    ultimoUsoNovo: (c, logins, desde) => ler(c, (l) => lerUltimoUsoNovo(l, c.hospital, logins, desde)),
    publicoPorGrupo: (c) => ler(c, (l) => contarPublicoPorGrupo(l)),
    setores: (c) => ler(c, (l) => lerSetoresCoex(l, c.hospital)),
    trilhas: (c) => ler(c, (l) => lerTrilhasCoex(l, c.hospital)),
    conclusoes: (c) => ler(c, (l) => lerConclusoesTreino(l, c.hospital)),
    retratos: (c, desde) => ler(c, (l) => lerRetratosConexao(l, c.hospital, desde)),
    usoDia: (c, desde) => ler(c, (l) => lerUsoDia(l, c.hospital, desde)),
    usoAoVivo: (c, dia) =>
      ler(c, async (l) => {
        const r: { operacao: string; setor: string; linhasDoDia: number; doNovo: number }[] = [];
        for (const m of MEDIDAS_USO)
          r.push({ operacao: m.operacao, setor: m.setor, ...(await contarUsoDoDia(l, c.hospital, m, dia)) });
        return r;
      }),
    lotes: (c, id) => ler(c, (l) => lerLotesCoex(l, c.hospital, id)),
    conducoes: (c, setor) => ler(c, (l) => lerConducoes(l, c.hospital, setor)),
    opcoesDosGrupos: (c, grupos) => ler(c, (l) => lerOpcoesDosGrupos(l, grupos)),
    chamados: (c, f) => ler(c, (l) => lerChamados(l, c.hospital, f)),
    contarChamados: (c, f) => ler(c, (l) => contarChamados(l, c.hospital, f)),
    chaves: (c) => ler(c, (l) => lerChavesLiberacao(l, c.hospital)),
    itensLigar: (c) => ler(c, (l) => lerItensLigar(l, c.hospital)),
    // M42 (regra 1): o cadastro de feriados (o de todo ano, ano 9999, repetido em cada ano do período).
    feriados: (c, de, ate) =>
      ler(c, async (l) => {
        const anoDe = Number(de.slice(0, 4));
        const anoAte = Number(ate.slice(0, 4));
        const r = new Set<string>();
        for (const f of await feriadosDoPeriodo(l, de, ate)) {
          const d = f.data.slice(0, 10);
          if (d.startsWith('9999-')) for (let a = anoDe; a <= anoAte; a++) r.add(`${a}${d.slice(4)}`);
          else r.add(d);
        }
        return [...r].sort();
      }),
    // M43: o fim da coexistência (sem grupo, logins de painel, competência e a série das conexões ao banco).
    usuariosRevisao: (c) => ler(c, (l) => lerUsuariosParaRevisao(l)),
    contagemUsuariosFim: (c) => ler(c, (l) => contarUsuariosFim(l)),
    gruposAtivos: (c) => ler(c, (l) => lerGruposAtivos(l)),
    competenciaFim: (c) =>
      ler(c, async (l) => {
        const u = await lerUltimaCompetenciaFechada(l);
        return u ? lerCompetenciaPeloNovo(l, c.hospital, u.ano, u.mes) : null;
      }),
    serieOutroSistema: (c, desde) => ler(c, (l) => lerSerieConexoesOutro(l, c.hospital, desde)),
    // M58 (F1): as leituras do painel do desligamento numa transação de leitura (só agregados e estrutura).
    leituraDesligamento: (c, p) =>
      ler(c, async (l) => ({
        sessoes: await lerSessoesOutroSistema(l, p.desde, p.inicioJanela, p.excluidos),
        contas: p.comContas ? await lerContasTecnicasBanco(l) : null,
        plataforma: await lerPlataformaBanco(l),
        funcoes: await lerFuncoesBanco(l),
        itens: await lerItensDesligamento(l, c.hospital),
      })),
    plataformaBanco: (c) =>
      ler(c, async (l) => ({ plataforma: await lerPlataformaBanco(l), funcoes: await lerFuncoesBanco(l) })),
    catalogoRetrocompatibilidade: (c) => ler(c, (l) => lerCatalogoRetrocompatibilidade(l)),
    versoesRegistro: (c, tipo) => ler(c, (l) => lerVersoesRegistroCoex(l, c.hospital, tipo)),
    // M40 (campo 4): três leituras agregadas por dia e unidade numa transação de leitura (o serviço guarda por 1 h).
    acompanhamentoOnda2: (c, de, ate) =>
      ler(c, async (l) => ({
        checagem: await lerChecagemAgregada(l, de, ate),
        higienizacao: await lerHigienizacaoAgregada(l, c.hospital, de, ate),
        registros: await lerRegistrosPorDia(l, c.hospital, de, ate),
      })),
    async carga(c): Promise<CargaAgora | null> {
      if (!nucleo) return null;
      try {
        const x = await ler(c, (l) => coletar(l, { estabelecimento: c.hospital }));
        return {
          conexoesPorSistema: x.porSistema.map((s) => ({ sistema: s.sistema, conexoes: s.conexoes })),
          transacoesLongas: x.alertas.filter((a) => a.tipo === 'transacao-longa').length,
          esperasPorTrava: x.porSistema.reduce((t, s) => t + s.esperasPorTrava, 0),
          em: x.em,
        };
      } catch {
        return null;
      }
    },
  };
}

const comoMudanca = (l: {
  escopo: string;
  valor: string;
  ligada: boolean | null;
  ligadaAntes: boolean | null;
}) => ({
  escopo: l.escopo as 'hospital' | 'setor' | 'grupo' | 'pessoa',
  valor: l.valor,
  ligada: l.ligada,
  antes: l.ligadaAntes,
});

function lotes(
  transacao: <T>(c: ContextoCoex, fn: (e: Escritor) => Promise<T>) => Promise<T>,
): Pick<PortaCoexistencia, 'aplicarLote' | 'recolherLote'> {
  return {
    aplicarLote: (c, p, trilha) =>
      transacao(c, (e) => aplicarLoteCoexistencia(e, { ...p, hospital: c.hospital }, trilha)),
    recolherLote: (c, p, trilha) =>
      transacao(c, (e) =>
        recolherLoteCoexistencia(
          e,
          {
            hospital: c.hospital,
            id: p.id,
            justificativa: p.justificativa,
            autor: p.autor,
            chaves: p.chaves,
            reverter: (linhas, estado) => {
              const lote = linhas[0]?.lote ?? null;
              const doLote = estado.chaves.filter((x) => x.lote === lote);
              if (doLote.length !== linhas.length)
                throw new Error(
                  'Um lote posterior mudou estas chaves: recolha primeiro o lote mais recente.',
                );
              return reverterLote(doLote.map(comoMudanca));
            },
          },
          trilha,
        ),
      ),
  };
}

export function portaCoexistenciaLegado(nucleo: NucleoLegado): PortaCoexistencia {
  const ctx = (c: ContextoCoex) => ({ rede: c.rede, hospital: c.hospital, traceId: 'coexistencia' });
  return {
    destino: 'legado',
    gravarSgh: (c, trilha, fn) =>
      nucleo.gravarSgh(ctx(c), async (e) => {
        const r = await fn(gravador(e, c));
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      }),
    ...lotes((c, fn) => nucleo.gravarSgh(ctx(c), fn)),
    ...leituras((c, fn) => nucleo.lerSomente(ctx(c), fn), nucleo),
  };
}

/** A porta sobre uma transação aberta (testes de integração na cópia, desfeita no fim). */
export function portaCoexistenciaNaTransacao(e: Escritor): PortaCoexistencia {
  return {
    destino: 'legado',
    async gravarSgh(c, trilha, fn) {
      const r = await fn(gravador(e, c));
      await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
      return r;
    },
    ...lotes((_c, fn) => fn(e)),
    ...leituras((_c, fn) => fn(e), null),
  };
}

export function portaCoexistenciaIndisponivel(): PortaCoexistencia {
  return portaIndisponivel<PortaCoexistencia>(METODOS_PORTA_COEXISTENCIA);
}
