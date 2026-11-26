// Cliente das rotas da configuração do faturamento SUS (C1-051, 06-SUS linha 53): /api/sus/configuracao — a permissão
// por usuário e setor e os parâmetros próprios de cada instrumento.
import {
  type CamposParametroSus,
  type EncerrarPermissaoSetorSusEntrada,
  esquemaConfiguracaoSusTela,
  esquemaParametrosInstrumentoSus,
  esquemaPermissaoSetorSusLida,
  type IncluirPermissaoSetorSusEntrada,
  type InstrumentoParametroSus,
  type ParametrosInstrumentoSus,
} from '@sgh/contratos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const B = '/api/sus/configuracao';

export const lerConfiguracaoSus = () => ler(B, esquemaConfiguracaoSusTela);

export const incluirPermissaoSetorSus = (corpo: IncluirPermissaoSetorSusEntrada) =>
  enviar(`${B}/permissoes`, corpo, esquemaPermissaoSetorSusLida, novaChave('sus-permissao-setor'));

export const encerrarPermissaoSetorSus = (id: number, corpo: EncerrarPermissaoSetorSusEntrada) =>
  enviar(
    `${B}/permissoes/${id}/encerrar`,
    corpo,
    esquemaPermissaoSetorSusLida,
    novaChave('sus-permissao-setor-encerrar'),
  );

export async function gravarParametrosSus(
  instrumento: InstrumentoParametroSus,
  corpo: { campos: CamposParametroSus; versao: string | null },
): Promise<ParametrosInstrumentoSus> {
  const r = await fetch(`${B}/parametros/${instrumento}`, {
    method: 'PUT',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave('sus-parametro-instrumento'),
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaParametrosInstrumentoSus.parse(await r.json());
}
