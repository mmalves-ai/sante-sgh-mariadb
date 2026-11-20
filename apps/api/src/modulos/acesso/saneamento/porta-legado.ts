// A porta do saneamento (M59-F4) sobre o núcleo do legado: leituras READ ONLY (lerSomente) e o plano só pela transação
// SGH_ (gravarSgh), com a SGH_TRILHA na mesma transação. Só @sgh/legado fala com o banco.
import {
  aprovarItemSaneamento,
  concluirItemSaneamento,
  descartarItemSaneamento,
  incluirItemSaneamento,
  lerGruposComOpcoes,
  lerGruposGenericos,
  lerItemSaneamento,
  lerPlanoSaneamento,
  lerTitulosOpcoes,
  lerUsoOpcoesDoGrupo,
  lerUsuarioSaneamento,
  lerUsuariosDoGrupoGenerico,
  type NucleoLegado,
  reservarItemSaneamento,
  saneamentoPronto,
} from '@sgh/legado';
import type { PortaSaneamento } from './porta.js';

export function portaSaneamentoDoNucleo(
  nucleo: Pick<NucleoLegado, 'rede' | 'lerSomente' | 'gravarSgh'>,
): PortaSaneamento {
  const ctx = (hospital: string, traceId = 'acesso-saneamento') => ({ rede: nucleo.rede, hospital, traceId });
  return {
    pronto: (h) => nucleo.lerSomente(ctx(h), (l) => saneamentoPronto(l)),
    grupos: (h, nomes) => nucleo.lerSomente(ctx(h), (l) => lerGruposGenericos(l, nomes)),
    usuarios: (h, g) => nucleo.lerSomente(ctx(h), (l) => lerUsuariosDoGrupoGenerico(l, g)),
    usuario: (h, login) => nucleo.lerSomente(ctx(h), (l) => lerUsuarioSaneamento(l, login)),
    gruposComOpcoes: (h) => nucleo.lerSomente(ctx(h), (l) => lerGruposComOpcoes(l)),
    titulos: (h, ids) => nucleo.lerSomente(ctx(h), (l) => lerTitulosOpcoes(l, ids)),
    uso: (h, g, desde) => nucleo.lerSomente(ctx(h), (l) => lerUsoOpcoesDoGrupo(l, g, desde)),
    plano: (h, g) => nucleo.lerSomente(ctx(h), (l) => lerPlanoSaneamento(l, h, g)),
    item: (h, id) => nucleo.lerSomente(ctx(h), (l) => lerItemSaneamento(l, h, id)),
    incluir: (h, n, t) => nucleo.gravarSgh(ctx(h, t.correlacao), (e) => incluirItemSaneamento(e, n, t)),
    aprovar: (h, a, t) =>
      nucleo.gravarSgh(ctx(h, t.correlacao), (e) => aprovarItemSaneamento(e, { ...a, hospital: h }, t)),
    descartar: (h, d, t) =>
      nucleo.gravarSgh(ctx(h, t.correlacao), (e) => descartarItemSaneamento(e, { ...d, hospital: h }, t)),
    reservar: (h, r, t) =>
      nucleo.gravarSgh(ctx(h, t.correlacao), (e) => reservarItemSaneamento(e, { ...r, hospital: h }, t)),
    concluir: (h, c, t) =>
      nucleo.gravarSgh(ctx(h, t.correlacao), (e) => concluirItemSaneamento(e, { ...c, hospital: h }, t)),
  };
}
