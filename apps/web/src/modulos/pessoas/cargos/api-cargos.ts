// Cliente da tela "Cargos e salários" (W0-06, parte 4b; M1 de mercado): apoio, lista, busca do CBO, ficha e as
// gravações (cargo, faixa salarial e vaga: inclusão, alteração com motivo ou versão, situação e exclusão). Cada gravação
// leva o CSRF e uma Idempotency-Key por intenção; a recusa (409 com `codigo` e `bloqueios`) vira ErroApi.
import type {
  AlterarCargoEntrada,
  ApoioCargos,
  ExcluirCargosEntrada,
  FichaCargo,
  IncluirCargoEntrada,
  IncluirFaixaSalarialEntrada,
  IncluirVagaEntrada,
  ListaCargos,
  ResultadoCargos,
  SituacaoCargosEntrada,
  VersaoFaixaSalarialEntrada,
  VersaoVagaEntrada,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, novaChave, qs } from '../../exames/api-exames.js';

const P = '/api/pessoas/cargos';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');
const resultado = confiar<ResultadoCargos>();

export const lerApoioCargos = (): Promise<ApoioCargos> => ler(`${P}/apoio`, confiar<ApoioCargos>());
export const lerCargos = (): Promise<ListaCargos> => ler(P, confiar<ListaCargos>());
export const lerFichaCargo = (cargo: number): Promise<FichaCargo> =>
  ler(`${P}/${cargo}`, confiar<FichaCargo>());
export const buscarCbo = (termo: string): Promise<{ codigo: string; rotulo: string }[]> =>
  ler(`${P}/cbo${qs({ termo })}`, z.array(z.object({ codigo: z.string(), rotulo: z.string() })));

export const incluirCargo = (e: IncluirCargoEntrada): Promise<ResultadoCargos> =>
  enviar(P, e, resultado, novaChave('pessoas.cargo'));
export const alterarCargo = (e: AlterarCargoEntrada): Promise<ResultadoCargos> => {
  const { cargo, ...resto } = e;
  return enviar(`${P}/${cargo}/alteracao`, resto, resultado, novaChave('pessoas.cargo.alt'));
};
export const situacaoCargos = (e: SituacaoCargosEntrada): Promise<ResultadoCargos> =>
  enviar(`${P}/situacao`, e, resultado, novaChave('pessoas.cargo.sit'));
export const excluirCargos = (e: ExcluirCargosEntrada): Promise<ResultadoCargos> =>
  enviar(`${P}/exclusao`, e, resultado, novaChave('pessoas.cargo.exc'));

export const incluirFaixa = (e: IncluirFaixaSalarialEntrada): Promise<ResultadoCargos> =>
  enviar(`${P}/faixas`, e, resultado, novaChave('pessoas.faixa'));
export const versaoFaixa = (e: VersaoFaixaSalarialEntrada): Promise<ResultadoCargos> => {
  const { faixa, ...resto } = e;
  return enviar(`${P}/faixas/${faixa}/versao`, resto, resultado, novaChave('pessoas.faixa.ver'));
};
export const incluirVaga = (e: IncluirVagaEntrada): Promise<ResultadoCargos> =>
  enviar(`${P}/vagas`, e, resultado, novaChave('pessoas.vaga'));
export const versaoVaga = (e: VersaoVagaEntrada): Promise<ResultadoCargos> => {
  const { vaga, ...resto } = e;
  return enviar(`${P}/vagas/${vaga}/versao`, resto, resultado, novaChave('pessoas.vaga.ver'));
};
