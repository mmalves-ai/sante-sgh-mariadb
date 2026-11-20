// Regra 4 do M08 (cap-14 §14.4.2): sem exclusão física por padrão. Inativar preserva as referências: o item
// inativo some das escolhas e continua legível nos registros antigos. Antes de inativar, o uso do item é
// lido pelas FKs do catálogo RDB$ (EXISTS por FK, uma consulta por referência): a FK RESTRICT faria o
// legado recusar a EXCLUSÃO, não a inativação; por isso item em uso pede confirmação ("em uso"), e item
// sem uso inativa direto.
export interface ReferenciaFk {
  readonly regra: 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'NO ACTION';
  readonly usos: boolean;
}

export type DecisaoInativacao =
  | { readonly tipo: 'pode' }
  | { readonly tipo: 'confirmar'; readonly aviso: string }
  | { readonly tipo: 'ja-inativo' };

export function decidirInativacao(o: {
  readonly ativo: boolean;
  readonly referencias: readonly ReferenciaFk[];
  readonly confirmado: boolean;
}): DecisaoInativacao {
  if (!o.ativo) return { tipo: 'ja-inativo' };
  const usadas = o.referencias.filter((r) => r.usos);
  if (usadas.length === 0 || o.confirmado) return { tipo: 'pode' };
  return {
    tipo: 'confirmar',
    aviso: `Item em uso em ${usadas.length} ${usadas.length === 1 ? 'cadastro' : 'cadastros'} do sistema. Inativar não apaga nem muda os registros antigos: o item só deixa de aparecer nas escolhas.`,
  };
}

/** Aviso de uso para a tela (null: sem uso). */
export function avisoDeUso(referencias: readonly ReferenciaFk[]): string | null {
  const d = decidirInativacao({ ativo: true, referencias, confirmado: false });
  return d.tipo === 'confirmar' ? d.aviso : null;
}
