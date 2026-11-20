<script setup lang="ts">
// Migração gradual: por pessoa (M37, ficha seção 7; regra 1): login, nome de usuário, papel, setores, trilha concluída,
// acesso ao novo e a última conexão no outro sistema com os dias desde então (pelos retratos). Só com
// config.coexistenciaPessoas.ler; a leitura vai à trilha. Nenhum dado de paciente.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { lerPessoas, lerSetores } from '../api.js';
import AbasMigracao from '../componentes/AbasMigracao.vue';

const { t } = useI18n();
const setor = ref('');
const termo = ref('');
const pagina = ref(1);
const filtro = ref({ setor: '', termo: '', pagina: 1 });
const setores = useQuery({ queryKey: ['coexistencia', 'setores'], queryFn: lerSetores });
const consulta = useQuery({
  queryKey: computed(() => ['coexistencia', 'pessoas', filtro.value]),
  queryFn: () => lerPessoas(filtro.value),
});
const opcoesSetor = computed(() => [
  { valor: '', rotulo: t('coexistencia.todos') },
  ...(setores.data.value?.setores ?? []).map((s) => ({ valor: s.codigo, rotulo: s.nome })),
]);
function buscar(): void {
  pagina.value = 1;
  filtro.value = { setor: setor.value, termo: termo.value, pagina: 1 };
}
function irPara(n: number): void {
  pagina.value = n;
  filtro.value = { ...filtro.value, pagina: n };
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="titulo-pessoas" data-testid="tela-migracao-pessoas">
    <h1 id="titulo-pessoas">{{ t('coexistencia.pessoas.titulo') }}</h1>
    <AbasMigracao atual="pessoas" />
    <p>{{ t('coexistencia.pessoas.texto') }}</p>
    <form class="filtros" :aria-label="t('coexistencia.filtros')" @submit.prevent="buscar">
      <SanteSelecao
        id="pessoas-setor"
        v-model="setor"
        :rotulo="t('coexistencia.setor')"
        :opcoes="opcoesSetor"
        data-testid="pessoas-setor"
      />
      <div class="campo">
        <label for="pessoas-termo">{{ t('coexistencia.pessoas.termo') }}</label>
        <input id="pessoas-termo" v-model="termo" data-testid="pessoas-termo" />
      </div>
      <SanteBotao
        :rotulo="t('coexistencia.buscar')"
        variante="secundario"
        tipo="submit"
        data-testid="pessoas-buscar"
      />
    </form>
    <MensagemErro v-if="consulta.error.value" :erro="consulta.error.value" />
    <p v-else-if="!consulta.data.value" role="status">{{ t('coexistencia.carregando') }}</p>
    <template v-else>
      <p data-testid="pessoas-total">
        {{ t('coexistencia.pessoas.total', { n: consulta.data.value.total }) }}
      </p>
      <table class="tabela" data-testid="tabela-pessoas">
        <caption>
          {{
            t('coexistencia.pessoas.legenda')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('coexistencia.pessoas.login') }}</th>
            <th scope="col">{{ t('coexistencia.pessoas.nome') }}</th>
            <th scope="col">{{ t('coexistencia.pessoas.papel') }}</th>
            <th scope="col">{{ t('coexistencia.pessoas.setores') }}</th>
            <th scope="col">{{ t('coexistencia.pessoas.trilha') }}</th>
            <th scope="col">{{ t('coexistencia.pessoas.acesso') }}</th>
            <th scope="col">{{ t('coexistencia.pessoas.ultimoNovo') }}</th>
            <th scope="col">{{ t('coexistencia.pessoas.ultimaOutro') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in consulta.data.value.itens" :key="p.login" :data-testid="`pessoa-${p.login}`">
            <th scope="row">{{ p.login }}</th>
            <td>{{ p.nome ?? '—' }}</td>
            <td>{{ p.papel ? t(`coexistencia.papeis.${p.papel}`) : '—' }}</td>
            <td>{{ p.setores.length }}</td>
            <td>{{ p.trilhaConcluida ? t('coexistencia.sim') : t('coexistencia.nao') }}</td>
            <td>{{ p.acessoNovo ? t('coexistencia.sim') : t('coexistencia.nao') }}</td>
            <td data-testid="ultimo-novo">{{ p.ultimoUsoNovo ?? '—' }}</td>
            <td data-testid="ultima-outro">
              {{
                p.ultimaConexaoOutro
                  ? t('coexistencia.pessoas.dias', { quando: p.ultimaConexaoOutro, n: p.diasSemOutro ?? 0 })
                  : t('coexistencia.pessoas.nunca')
              }}
            </td>
          </tr>
        </tbody>
      </table>
      <nav :aria-label="t('coexistencia.paginas')" class="filtros">
        <SanteBotao
          v-if="pagina > 1"
          :rotulo="t('coexistencia.anterior')"
          variante="texto"
          @acionar="irPara(pagina - 1)"
        />
        <SanteBotao
          v-if="pagina * 50 < consulta.data.value.total"
          :rotulo="t('coexistencia.proxima')"
          variante="texto"
          @acionar="irPara(pagina + 1)"
        />
      </nav>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
