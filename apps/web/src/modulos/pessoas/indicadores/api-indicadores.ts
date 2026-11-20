// Cliente do painel de indicadores de pessoas (W0-06, parte 7d; M4 de mercado): só leitura. O apoio traz a data de
// hoje, os setores do filtro e as horas da COFEN que valem; o painel, os seis indicadores do recorte com a ficha técnica
// e as parcelas. A resposta passa pelo mesmo Zod do servidor.
import {
  esquemaApoioIndicadoresPessoas,
  esquemaPainelIndicadoresPessoas,
  type ApoioIndicadoresPessoas,
  type PainelIndicadoresPessoas,
} from '@sgh/contratos';
import { ler, qs } from '../../exames/api-exames.js';

const P = '/api/pessoas/indicadores';

export const lerApoioIndicadores = (): Promise<ApoioIndicadoresPessoas> =>
  ler(`${P}/apoio`, esquemaApoioIndicadoresPessoas);

export const lerPainelIndicadores = (f: {
  inicio: string;
  fim: string;
  setor: number | null;
}): Promise<PainelIndicadoresPessoas> =>
  ler(`${P}${qs({ inicio: f.inicio, fim: f.fim, setor: f.setor })}`, esquemaPainelIndicadoresPessoas);
