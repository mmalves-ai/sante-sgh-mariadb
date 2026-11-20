// A porta da conferência da instalação sobre o núcleo: duas leituras numa transação READ ONLY do estabelecimento.
import { lerConexaoAtual, lerRelogioBanco, lerScriptsRegistrados, type NucleoLegado } from '@sgh/legado';
import { portaIndisponivel } from '../exames/public-api.js';
import { METODOS_PORTA_IMPLANTACAO, type PortaImplantacao } from './porta.js';

export function portaImplantacaoLegado(nucleo: NucleoLegado): PortaImplantacao {
  const ctx = (c: { rede: string; hospital: string }) => ({
    rede: c.rede,
    hospital: c.hospital,
    traceId: 'implantacao',
  });
  return {
    destino: 'legado',
    conexao: (c) => nucleo.lerSomente(ctx(c), (l) => lerConexaoAtual(l)),
    scriptsRegistrados: (c) => nucleo.lerSomente(ctx(c), (l) => lerScriptsRegistrados(l)),
    relogioBanco: (c) => nucleo.lerSomente(ctx(c), (l) => lerRelogioBanco(l)),
  };
}

export function portaImplantacaoIndisponivel(): PortaImplantacao {
  return portaIndisponivel<PortaImplantacao>(METODOS_PORTA_IMPLANTACAO);
}
