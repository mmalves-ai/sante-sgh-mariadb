// Símbolos de injeção da recepção (M19).
export const CENTRAL_CHAMADAS = Symbol('CENTRAL_CHAMADAS');
/** Serviço do painel de leitos (M16) para o painel de TV de setor, quando o módulo está no ar. */
export const PAINEL_LEITOS_TV = Symbol('PAINEL_LEITOS_TV');
/** A rede deste processo (o totem e as TVs não têm sessão: a rede é a da API). */
export const REDE_RECEPCAO = Symbol('REDE_RECEPCAO');
/** M44: o painel de TV do PA (senha ou iniciais, cor com o nome e a espera; nunca nome nem diagnóstico). */
export const PAINEL_PA_TV = Symbol('PAINEL_PA_TV');
/** M46 (etapa 2): o painel para familiares do bloco (código anônimo, etapa e horário). */
export const PAINEL_BLOCO_TV = Symbol('PAINEL_BLOCO_TV');
