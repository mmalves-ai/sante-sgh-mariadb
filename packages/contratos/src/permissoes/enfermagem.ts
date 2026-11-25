// Permissões do M25 (ficha, seção 7; convencoes.md §12): enfermagem beira-leito — a linha do tempo do turno, o
// aprazamento, a checagem em tela e por código de barras (pulseira, dose, dupla checagem, infusão), os conflitos de
// sincronização, os sinais vitais, a passagem de plantão e os dispositivos do modo beira do leito. Quem tem a opção no
// legado tem a permissão no novo (regra 1 do M06). Opções do módulo do PEP (menu de origem, retrato
// tools/verificadores/dados/acesso-legado.pc.json):
//   - Checagem da enfermagem 3954 (Consultar 5535, Imprimir 5537, Não checado 3962) › Checagem geral 5301 (Checar
//     5302, Checar com código de barras 6857/6975, Gravar 5304, Checar todos 5305, Assinar 5705, Validar assinatura
//     5880, Confirmar avaliação 5706, Reaprazar 6744, Pendente de confirmação 6858, Cancelar a pendência 6859,
//     Cancelar 5882); a checagem antiga 3379 (Checar 3380); Prescrição geral › Aprazar 4590 e Aprazar/avaliar 5678;
//     Pendências de aprazamento 4612 (Consultar 5532);
//   - Monitorização 2642 (Consultar 5542, Incluir sinal vital 5712, Incluir horário 5713, Confirmar 4633, Assinar 5711,
//     Corrigir valor do sinal vital 5715, Alterar 5332, Consulta 5331);
//   - Checagem automatizada 3361 (Alterar 3362) e o utilitário dela (4682, 4683, 4684): os aparelhos da checagem.
// Perfil da trilha do legado (cópia pc, só contagens): a checagem registrada na opção 5302 (tipo 3, alvo o horário:
// 58 eventos em 2026, 41 em 2020) e a abertura da checagem (5302 e 3954, tipo 24). A passagem de plantão é recurso
// novo: quem checa no legado passa e recebe o plantão (D-PERM-25).
import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_ENFERMAGEM = {
  horarioLer: 'enfermagem.horario.ler',
  horarioAprazar: 'enfermagem.horario.aprazar',
  administracaoLer: 'enfermagem.administracao.ler',
  administracaoChecar: 'enfermagem.administracao.checar',
  administracaoConferir: 'enfermagem.administracao.conferir',
  administracaoEstornar: 'enfermagem.administracao.estornar',
  conflitoResolver: 'enfermagem.conflito.resolver',
  sinalLer: 'enfermagem.sinalVital.ler',
  sinalCriar: 'enfermagem.sinalVital.criar',
  sinalRetificar: 'enfermagem.sinalVital.retificar',
  plantaoLer: 'enfermagem.plantao.ler',
  plantaoPassar: 'enfermagem.plantao.passar',
  plantaoAceitar: 'enfermagem.plantao.aceitar',
  dispositivoLer: 'enfermagem.dispositivo.ler',
  dispositivoEditar: 'enfermagem.dispositivo.editar',
  // 09-AREA linha 86 (C1-035): a auditoria das checagens (amostra sorteada, auditores e avaliação de cada checagem).
  auditoriaChecagemLer: 'enfermagem.auditoriaChecagem.ler',
  auditoriaChecagemAuditar: 'enfermagem.auditoriaChecagem.auditar',
  // 03-PEP linha 115 (C2-003): limites de alerta dos sinais vitais e regra do parâmetro no setor.
  limiteSinalEditar: 'enfermagem.limiteSinal.editar',
  // 01-ADM L117 (C2-053): criar, ligar e desligar a regra de risco clínico que vale para toda a rede.
  regraRiscoRedePublicar: 'enfermagem.regraRiscoRede.publicar',
} as const;
const P = PERMISSOES_ENFERMAGEM;

const p = (
  codigo: string,
  descricao: string,

  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,

  concessaoPorPerfil: null,
  categoria: 'clinica',
  criticidade: 'sensivel',
  ...extra,
});

export const PERMISSOES_ENFERMAGEM_M25: readonly DeclaracaoPermissao[] = [
  p(
    P.horarioLer,
    'Ver a linha do tempo do turno (doses por hora, atrasos, suspensões, cuidados) e os horários da prescrição',
  ),
  p(
    P.horarioAprazar,
    'Aprazar, reaprazar e suprimir os horários da prescrição (ato do enfermeiro)',

    { exigeConselho: true },
  ),
  p(P.administracaoLer, 'Ver a checagem da administração com o histórico de cada horário'),
  p(
    P.administracaoChecar,
    'Checar a administração (administrado ou não administrado com o motivo), com a leitura da pulseira e da dose',
  ),
  p(
    P.administracaoConferir,
    'Conferir a administração como segundo profissional (dupla checagem da alta vigilância e do hemocomponente)',
  ),
  p(
    P.administracaoEstornar,
    'Estornar a checagem com a justificativa (o registro original fica guardado)',

    { criticidade: 'critica' },
  ),
  p(
    P.conflitoResolver,
    'Resolver os conflitos de sincronização da beira do leito (ato feito sem rede depois de suspensão ou checagem)',
  ),
  p(P.sinalLer, 'Ver os sinais vitais e controles em grade e gráfico, com a glicemia e o laboratório'),
  p(P.sinalCriar, 'Registrar sinais vitais e controles (com a unidade e a faixa plausível)'),
  p(P.sinalRetificar, 'Retificar um sinal vital com a justificativa (a versão anterior fica guardada)'),
  p(P.plantaoLer, 'Ver a passagem de plantão da unidade (notas SBAR, pendências e aceites)'),
  p(P.plantaoPassar, 'Passar o plantão com a nota SBAR de cada paciente e as pendências herdadas'),
  p(P.plantaoAceitar, 'Aceitar o plantão recebido (a responsabilidade passa com o aceite)'),
  p(
    P.dispositivoLer,
    'Ver os tablets e coletores autorizados ao modo beira do leito',

    { categoria: 'tecnica', criticidade: 'normal' },
  ),
  p(
    P.dispositivoEditar,
    'Autorizar e retirar tablets e coletores do modo beira do leito',

    { categoria: 'tecnica', criticidade: 'normal' },
  ),
  // Recurso só do novo (09-AREA linha 86): concedido por perfil à qualidade, à auditoria e à enfermagem com conselho.
  p(P.auditoriaChecagemLer, 'Ver as auditorias das checagens de enfermagem, com a amostra e o resultado', {
    concessaoPorPerfil: 'por-perfil',
    perfis: ['gestao-qualidade', 'auditor', 'assistencial-com-conselho', 'administrador-sistema'],
  }),
  p(
    P.auditoriaChecagemAuditar,
    'Abrir a auditoria das checagens (sorteio da amostra), avaliar cada checagem, concluir e cancelar com o motivo',
    {
      concessaoPorPerfil: 'por-perfil',
      perfis: ['gestao-qualidade', 'auditor', 'assistencial-com-conselho', 'administrador-sistema'],
    },
  ),
  // Recurso só do novo (03-PEP linha 115): concedido por perfil à enfermagem com conselho, à qualidade e ao administrador.
  p(
    P.limiteSinalEditar,
    'Cadastrar os limites de alerta dos sinais vitais (por setor, instrumento, sexo e idade) e a regra do parâmetro no setor',
    {
      concessaoPorPerfil: 'por-perfil',
      perfis: ['assistencial-com-conselho', 'gestao-qualidade', 'administrador-sistema'],
      criticidade: 'normal',
    },
  ),
  // Recurso só do novo (01-ADM L117): a regra de risco da rede vale para todos os hospitais do cliente; concedida
  // por perfil à diretoria da rede e ao administrador.
  p(
    P.regraRiscoRedePublicar,
    'Criar, ligar e desligar as regras de risco clínico da central de comando que valem para toda a rede',
    { concessaoPorPerfil: 'por-perfil', perfis: ['diretoria-rede', 'administrador-sistema'] },
  ),
];
