// Regra do prontuário na gravação do registro clínico (F3.3, 03-PEP L91): a configuração que vale para o setor e o tipo
// do atendimento (configuracao_setor_prontuario: setor e tipo, senão setor para "todos", senão o padrão do
// estabelecimento) decide se o horário clínico retroativo cabe e que assinatura é exigida. A digital ICP-Brasil só com
// certificado vigente do autor (certificado_usuario ativo, não revogado, dentro da validade). Lida na mesma transação
// da gravação; a recusa é 422 e nada fica gravado. Regra institucional: nunca preferência do usuário.
import {
  type AssinaturaExigida,
  type ConfiguracaoProntuario,
  type ConfiguracaoSetor,
  configuracaoPadraoDoEstabelecimento,
  conferirRegistroPelaConfiguracao,
  resolverConfiguracaoProntuario,
  tipoProntuarioDoAtendimento,
  type TipoAtendimentoProntuario,
} from '@sgh/dominio-pep';
import { ErroOperacao, type Leitor } from '@sgh/nucleo';

type Consultor = Pick<Leitor, 'uma' | 'consultar'>;

/** A configuração que vale para o atendimento, com o setor e de onde veio (setor-tipo, setor ou padrão). */
export async function configuracaoDoAtendimento(
  l: Consultor,
  estabelecimento: number,
  atendimento: number,
  assinaturaEstabelecimento: AssinaturaExigida | null | undefined,
): Promise<{
  readonly configuracao: ConfiguracaoProntuario;
  readonly origem: 'setor-tipo' | 'setor' | 'padrao';
  readonly setor: number | null;
}> {
  const a = await l.uma(
    `SELECT a.setor_funcional_id AS setor, c.tipo_base FROM atendimento a
       JOIN categoria_atendimento c ON c.id = a.categoria_atendimento_id
      WHERE a.id = ? AND a.estabelecimento_id = ?`,
    [atendimento, estabelecimento],
  );
  const setor = a && a['setor'] !== null && a['setor'] !== undefined ? Number(a['setor']) : null;
  const tipo = tipoProntuarioDoAtendimento(a ? String(a['tipo_base']) : null);
  const linhas =
    setor === null
      ? []
      : (
          await l.consultar(
            `SELECT setor_funcional_id, tipo_atendimento, permite_retroativo, tolerancia_retroativo_horas,
                    assinatura_exigida, exige_evolucao_medica, exige_evolucao_enfermagem, ativo
               FROM configuracao_setor_prontuario
              WHERE estabelecimento_id = ? AND setor_funcional_id = ? AND ativo = TRUE`,
            [estabelecimento, setor],
          )
        ).map((x): ConfiguracaoSetor => ({
          setor: Number(x['setor_funcional_id']),
          tipoAtendimento: String(x['tipo_atendimento']) as TipoAtendimentoProntuario,
          permiteRetroativo: Boolean(Number(x['permite_retroativo'])),
          toleranciaRetroativoHoras:
            x['tolerancia_retroativo_horas'] === null || x['tolerancia_retroativo_horas'] === undefined
              ? null
              : Number(x['tolerancia_retroativo_horas']),
          assinaturaExigida: String(x['assinatura_exigida']) as AssinaturaExigida,
          exigeEvolucaoMedica: Boolean(Number(x['exige_evolucao_medica'])),
          exigeEvolucaoEnfermagem: Boolean(Number(x['exige_evolucao_enfermagem'])),
          ativo: Boolean(Number(x['ativo'])),
        }));
  const r = resolverConfiguracaoProntuario(
    linhas,
    setor,
    tipo,
    configuracaoPadraoDoEstabelecimento(assinaturaEstabelecimento),
  );
  return { ...r, setor };
}

/** Confere o registro pela regra que vale; recusa 422 (retroativo-fora-da-regra ou assinatura-icp-exigida). */
export async function conferirRegraDoSetor(
  l: Consultor,
  x: {
    readonly estabelecimento: number;
    readonly atendimento: number;
    readonly usuario: number;
    readonly ocorridoEm: Date;
    readonly agora: Date;
    readonly assinaturaEstabelecimento: AssinaturaExigida | null | undefined;
  },
): Promise<void> {
  const { configuracao } = await configuracaoDoAtendimento(
    l,
    x.estabelecimento,
    x.atendimento,
    x.assinaturaEstabelecimento,
  );
  let certificado = false;
  if (configuracao.assinaturaExigida === 'digital_icp') {
    const c = await l.uma(
      `SELECT 1 AS ok FROM certificado_usuario
        WHERE usuario_id = ? AND situacao = 'ativo' AND excluido_em IS NULL AND revogado_em IS NULL
          AND valido_de <= UTC_TIMESTAMP(3) AND valido_ate > UTC_TIMESTAMP(3)
        LIMIT 1`,
      [x.usuario],
    );
    certificado = c !== null && c !== undefined;
  }
  const erro = conferirRegistroPelaConfiguracao(configuracao, {
    ocorridoEm: x.ocorridoEm,
    agora: x.agora,
    certificadoIcpVigente: certificado,
  });
  if (erro) throw new ErroOperacao(422, erro.codigo, 'Operação recusada', erro.mensagem);
}
