<script setup lang="ts">
// Construtor de formulários: modelos, perguntas e versões (ficha do M22, seção 7): CONSULTA dos modelos lidos na
// hora (a mudança de modelo, pergunta ou layout continua no editor de origem durante a coexistência; o novo
// regenera a representação), o relatório da conversão (componentes, regras convertidas para JSON Logic, escolhas
// a confirmar) e a pré-visualização pelo mesmo FormRenderer. Sem dado de paciente.
import { SanteAlerta } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { lerModeloAdmin, listarModelosAdmin } from '../api-registro.js';
import FormRenderer from '../componentes/formulario/FormRenderer.vue';

const { t } = useI18n();
const lista = useQuery({ queryKey: ['pep', 'admin', 'modelos'], queryFn: () => listarModelosAdmin() });
const escolhido = ref<number | null>(null);
const detalhe = useQuery({
  queryKey: computed(() => ['pep', 'admin', 'modelo', escolhido.value]),
  queryFn: () => lerModeloAdmin(escolhido.value!),
  enabled: computed(() => escolhido.value !== null),
});
const d = computed(() => detalhe.data.value);
</script>

<template>
  <section class="tela" aria-labelledby="adm-modelos-titulo" data-testid="tela-admin-modelos">
    <h1 id="adm-modelos-titulo">{{ t('pep.reg.admin.modelos.titulo') }}</h1>
    <p>{{ t('pep.reg.admin.modelos.texto') }}</p>
    <p>
      <RouterLink to="/pep/admin/formularios-novos" data-testid="atalho-formularios-novos">{{
        t('pep.formNovo.atalho')
      }}</RouterLink>
    </p>
    <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('pep.reg.carregando') }}</p>
    <div v-else class="rolagem">
      <table class="tabela" data-testid="tabela-modelos">
        <caption>
          {{
            t('pep.reg.admin.modelos.legenda', { n: lista.data.value.length })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('pep.reg.admin.modelos.colunas.codigo') }}</th>
            <th scope="col">{{ t('pep.reg.admin.modelos.colunas.nome') }}</th>
            <th scope="col">{{ t('pep.reg.admin.modelos.colunas.uso') }}</th>
            <th scope="col">{{ t('pep.reg.admin.modelos.colunas.vinculos') }}</th>
            <th scope="col">{{ t('pep.reg.admin.modelos.colunas.componentes') }}</th>
            <th scope="col">{{ t('pep.reg.admin.modelos.colunas.regras') }}</th>
            <th scope="col">{{ t('pep.reg.admin.modelos.colunas.pendencias') }}</th>
            <th scope="col">{{ t('pep.reg.admin.modelos.colunas.versoes') }}</th>
            <th scope="col">{{ t('pep.reg.admin.modelos.colunas.situacao') }}</th>
            <th scope="col">{{ t('pep.reg.admin.modelos.colunas.motivo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in lista.data.value" :key="m.id" :data-testid="`admin-modelo-${m.codigo}`">
            <td>
              <button
                type="button"
                class="link"
                :aria-label="
                  t('pep.reg.admin.modelos.abrir', { modelo: m.nome ? `${m.codigo} (${m.nome})` : m.codigo })
                "
                @click="escolhido = m.id"
              >
                {{ m.codigo }}
              </button>
            </td>
            <td>{{ m.nome }}</td>
            <td>{{ m.usoRecente }}</td>
            <td>{{ m.vinculosAtivos }} / {{ m.vinculos }}</td>
            <td>{{ m.componentesMapeados }} / {{ m.componentes }}</td>
            <td>{{ m.expressoesConvertidas }} / {{ m.expressoes }}</td>
            <td>{{ m.escolhasPendentes }}</td>
            <td>{{ m.versoesLayout }}</td>
            <td>{{ t(`pep.reg.escolha.situacoes.${m.situacao}`) }}</td>
            <td>{{ m.motivo ?? '' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <MensagemErro v-if="detalhe.isError.value" :erro="detalhe.error.value" />
    <section v-if="d" class="detalhe" aria-labelledby="adm-modelo-detalhe" data-testid="detalhe-modelo">
      <h2 id="adm-modelo-detalhe">
        {{ t('pep.reg.admin.modelos.detalhe', { modelo: `${d.codigo} · ${d.nome}` }) }}
      </h2>
      <p class="nota">{{ t('pep.reg.admin.modelos.impressao', { h: d.impressao.slice(0, 16) }) }}</p>
      <h3>{{ t('pep.reg.admin.modelos.versoesLista') }}</h3>
      <p v-if="d.versoes.length === 0">{{ t('pep.reg.admin.modelos.semVersao') }}</p>
      <ul v-else>
        <li v-for="v in d.versoes" :key="v.versao">
          {{ t('pep.reg.admin.modelos.versao', { v: v.versao, n: v.componentes }) }}
        </li>
      </ul>
      <h3>{{ t('pep.reg.admin.modelos.expressoes', { n: d.expressoesDetalhe.length }) }}</h3>
      <ul v-if="d.expressoesDetalhe.length > 0">
        <li v-for="(x, i) in d.expressoesDetalhe" :key="i">
          {{
            t('pep.reg.admin.modelos.expressao', {
              campo: x.campo,
              tipo: x.tipo,
              padrao: x.padrao,
              situacao: x.convertida
                ? t('pep.reg.admin.modelos.convertida')
                : t('pep.reg.admin.modelos.naoConvertida', { motivo: x.motivo ?? '' }),
            })
          }}
        </li>
      </ul>
      <h3>{{ t('pep.reg.admin.modelos.pendencias', { n: d.pendencias.length }) }}</h3>
      <ul v-if="d.pendencias.length > 0" class="pendencias">
        <li v-for="(p, i) in d.pendencias" :key="i">{{ p.campo ?? '—' }} · {{ p.tipo }}: {{ p.detalhe }}</li>
      </ul>
      <h3>{{ t('pep.reg.admin.modelos.previa') }}</h3>
      <SanteAlerta variante="info" :texto="t('pep.reg.admin.modelos.texto')" />
      <FormRenderer :campos="d.campos" :respostas="{}" :titulo="d.nome ?? ''" modo="visualizacao" />
    </section>
  </section>
</template>

<style scoped>
.tela {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-3);
}
.rolagem {
  overflow-x: auto;
}
.tabela {
  border-collapse: collapse;
  width: 100%;
}
.tabela caption {
  text-align: start;
  font-weight: 600;
}
.tabela th,
.tabela td {
  border-bottom: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  text-align: start;
}
.link {
  background: none;
  border: none;
  padding: 0;
  color: var(--sgh-primaria);
  text-decoration: underline;
  cursor: pointer;
  font: inherit;
}
.detalhe {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
  border-top: 1px solid var(--sgh-borda);
  padding-top: var(--sgh-espaco-3);
}
.detalhe h3 {
  font-size: 1rem;
  margin: var(--sgh-espaco-2) 0 0;
}
.pendencias {
  max-height: 16rem;
  overflow-y: auto;
}
.nota {
  font-size: 0.85em;
  color: var(--sgh-texto-secundario);
}
</style>
