// O botão global "Notificar incidente" (M48, etapa 1; ficha, seção 7): aparece para quem tem a permissão
// (qualidade.notificacao.criar, todo perfil de pessoa) e só com a funcionalidade liberada no estabelecimento (a chave
// qualidade.notificacao). Sem a resposta ainda, ou com erro, o botão não aparece (falha fechada).
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { lerBotaoNotificacao } from '../../modulos/qualidade/api.js';
import { usarSessao } from '../sessao/sessao.js';

export const PERMISSAO_NOTIFICAR = 'qualidade.notificacao.criar';

export function usarBotaoNotificar() {
  const { sessao, permissoes } = usarSessao();
  const temPermissao = computed(() => permissoes.value.has(PERMISSAO_NOTIFICAR));
  const botao = useQuery({
    queryKey: computed(() => ['qualidade', 'botao', sessao.value?.estabelecimentoAtivo ?? '']),
    queryFn: () => lerBotaoNotificacao(),
    enabled: temPermissao,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  return computed(() => temPermissao.value && botao.data.value?.ligada === true);
}
