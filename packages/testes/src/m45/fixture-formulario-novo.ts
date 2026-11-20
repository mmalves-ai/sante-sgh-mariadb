// Fixture da publicação do formulário novo (M45, etapa 1) para os testes do adaptador: o @sgh/legado só conhece os
// contratos (fronteira Nx), então a entrada da receita `pep.publicarFormularioNovo` montada pelo domínio fica num JSON
// versionado em packages/legado/src/pep/gravacao/__fixtures__/formulario-novo.json. Este módulo a monta; o teste ao
// lado confere que o JSON está em dia (e o regrava com FIXTURE_M45_REGRAVAR=sim).
import {
  CONSTANTES_SINTETICAS,
  contentHashFormularioNovo,
  entradaDaPublicacao,
  FORMULARIO_NOVO_SINTETICO,
} from '@sgh/dominio-pep';

export const CAMINHO_FIXTURE_M45 = new URL(
  '../../../legado/src/pep/gravacao/__fixtures__/formulario-novo.json',
  import.meta.url,
);

export async function fixtureFormularioNovo() {
  const def = FORMULARIO_NOVO_SINTETICO;
  const comReuso = {
    ...def,
    perguntas: [
      {
        ...def.perguntas[0]!,
        itens: def.perguntas[0]!.itens.map((p) => (p.linkId === 'peso' ? { ...p, reuso: 77 } : p)),
      },
    ],
  };
  const comEspecialidade = { ...def, especialidades: [40] };
  const banco = [{ id: 77, descricao: 'Peso', tipoperg: '6', unidade: 'kg', ativo: true, opcoes: [] }];
  const publicacao = async (d: typeof def, b: typeof banco = []) =>
    entradaDaPublicacao({
      definicao: d,
      versao: 1,
      codigosExistentes: new Set(),
      banco: b,
      respostasCadastradas: [],
      constantes: CONSTANTES_SINTETICAS,
      formulario: 5,
      versaoEsperada: 'v1',
      contentHash: await contentHashFormularioNovo(d),
    });
  return {
    definicao: def,
    publicacao: await publicacao(def),
    publicacaoComReuso: await publicacao(comReuso, banco),
    publicacaoComEspecialidade: await publicacao(comEspecialidade),
  };
}
