// Cliente da tela "Rubricas, incidências e tabelas legais" (M53.2, etapa F1): o apoio (domínios oficiais do eSocial,
// gravação e cadastros embutidos), as rubricas em vigor na competência com a conferência das incidências e a tabela legal
// em vigor com a conferência das faixas. Só leitura: a gravação é a do CRUD genérico embutido (DominioTela). As
// respostas são conferidas pelos esquemas de @sgh/contratos (o servidor é a fonte).
import {
  esquemaApoioRubricas,
  esquemaRubricasDaCompetencia,
  esquemaTabelasLegaisDaCompetencia,
} from '@sgh/contratos';
import { ler, qs } from '../../exames/api-exames.js';

const F = '/api/pessoas/folha';

export const lerApoioRubricas = () => ler(`${F}/rubricas/apoio`, esquemaApoioRubricas);

export const lerRubricasDaCompetencia = (f: {
  competencia: string;
  empresa?: number | null;
  todas?: boolean;
}) =>
  ler(
    `${F}/rubricas${qs({ competencia: f.competencia, empresa: f.empresa, todas: f.todas ? '1' : null })}`,
    esquemaRubricasDaCompetencia,
  );

export const lerTabelasLegais = (competencia: string) =>
  ler(`${F}/tabelas-legais${qs({ competencia })}`, esquemaTabelasLegaisDaCompetencia);
