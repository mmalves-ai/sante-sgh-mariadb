// A porta do PIN sobre o banco de origem (leitura somente leitura e gravação na transação própria com a trilha). Fica
// FORA do boot da F2-L (API_MODULOS): depende do pacote do banco de origem e serve de referência para o módulo da troca
// rápida sobre o banco do cliente (F2.2).
import {
  definirPin,
  lerPinVivo,
  lerSituacaoPin,
  type NucleoLegado,
  registrarConferenciaPin,
  retirarPin,
} from '@sgh/legado';
import type { PortaPin } from './porta-pin.js';

export function portaPinDoNucleo(nucleo: Pick<NucleoLegado, 'lerSomente' | 'gravarSgh'>): PortaPin {
  const ctx = (rede: string, hospital: string, traceId = 'acesso-pin') => ({ rede, hospital, traceId });
  return {
    destino: 'banco',
    situacao: (rede, h, login) => nucleo.lerSomente(ctx(rede, h), (l) => lerSituacaoPin(l, login)),
    vivo: (rede, h, login) => nucleo.lerSomente(ctx(rede, h), (l) => lerPinVivo(l, login)),
    definir: (rede, h, p, t) =>
      nucleo.gravarSgh(ctx(rede, h, t.correlacao), (e) => definirPin(e, { ...p, idTbusers: p.idUsuario }, t)),
    retirar: (rede, h, p, t) => nucleo.gravarSgh(ctx(rede, h, t.correlacao), (e) => retirarPin(e, p, t)),
    conferencia: (rede, h, p, t) =>
      nucleo.gravarSgh(ctx(rede, h, t.correlacao), (e) => registrarConferenciaPin(e, p, t)),
  };
}
