// Apoio da integração do portal do paciente na cópia (M50, etapa 1): o serviço sobre a porta do legado numa transação
// aberta (as tabelas SGH_ dos scripts 0500 a 0502 e as do M10, M11, M23 e M49), com os PACIENTES SINTÉTICOS sobrepostos
// à leitura do cadastro (nenhum paciente da cópia é lido: os IDs ficam acima de qualquer ID do cadastro e as tabelas
// SGH_ não têm FK para o legado). O relógio é controlado; a chave mestra é de teste.
import type { Escritor, PacienteParaPortalLido } from '@sgh/legado';
import { portaPortalNaTransacao } from '../porta-legado.js';
import type { PortaPortalPaciente } from '../porta.js';
import { ArmazemProvasMemoria } from './provas.js';
import { type QuemInterno, ServicoPortalPaciente } from './servico.js';

export const MAE = 2_000_050_001;
export const FILHO = 2_000_050_002;
export const OUTRO = 2_000_050_003;

const SINTETICOS: Record<number, PacienteParaPortalLido> = {
  [MAE]: pac(MAE, 950_001, '1990-07-01', 'Mae'),
  [FILHO]: pac(FILHO, 950_002, '2016-05-10', 'Filho'),
  [OUTRO]: pac(OUTRO, 950_003, '1980-01-01', 'Outro'),
};

function pac(
  id: number,
  prontuario: number,
  nascimento: string,
  primeiroNome: string,
): PacienteParaPortalLido {
  return {
    id,
    prontuario,
    nascimento,
    ativo: true,
    obito: false,
    unificadoEm: null,
    primeiroNome,
    capacidadeCivil: null,
    temGuardiao: false,
  };
}

export function portaSintetica(e: Escritor): PortaPortalPaciente {
  const base = portaPortalNaTransacao(e);
  return {
    ...base,
    paciente: async (_c, id) => SINTETICOS[id] ?? null,
    pacientesPorProntuario: async (_c, p) => Object.values(SINTETICOS).filter((x) => x.prontuario === p),
    guardiaoConfere: async () => false,
  };
}

/** A funcionalidade `portal.conta` ligada no estabelecimento (com o pré-requisito dispensado), sem parâmetro gravado. */
const CONFIG_LIGADA = {
  chaves: async () => [
    { chave: 'portal.conta', tipo: 'recurso', escopo: 'hospital', valor: '*', ligada: true },
  ],
  prerequisitos: async () => [
    { recurso: 'portal.conta', tipo: 'aprovacao', situacao: 'dispensado', validade: null },
  ],
  valoresParametro: async () => [],
} as unknown as ConstructorParameters<typeof ServicoPortalPaciente>[2];

export function servicoNaCopia(e: Escritor, rede: string, relogio: { agora: Date }): ServicoPortalPaciente {
  return new ServicoPortalPaciente(
    portaSintetica(e),
    null,
    CONFIG_LIGADA,
    new ArmazemProvasMemoria(),
    { rede, produto: 'Produto de teste', chaveMestra: Buffer.alloc(32, 5), estabelecimentoPadrao: null },
    null,
    () => relogio.agora,
  );
}

export const quem = (rede: string, hospital: string, login: string): QuemInterno => ({
  rede,
  hospital,
  login,
  estacao: 'SGH-TESTE:integracao',
  correlacao: 'int-m501',
  origem: null,
});
