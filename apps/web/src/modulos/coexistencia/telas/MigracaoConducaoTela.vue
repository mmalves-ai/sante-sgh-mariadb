<script setup lang="ts">
// Migração gradual: condução opcional (M37, ficha seção 7; regra 6): por setor, a lista proposta dos pares grupo × opção
// (as opções das operações do setor que os grupos dele têm), o impacto por grupo (usuários ativos no setor e fora dele;
// o par com gente fora do setor só com a decisão do gestor de acessos), a retirada em lote com a autorização do dono e a
// devolução exata. A gravação é a operação do protocolo de permissões do grupo; recolher é devolver, pela mesma tela.
import { SETORES_PRONTIDAO } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { devolverConducao, lerConducao, retirarConducao } from '../api.js';
import AbasMigracao from '../componentes/AbasMigracao.vue';

const { t } = useI18n();
const { permissoes } = usarSessao();
const cliente = useQueryClient();
const setor = ref('');
const consulta = useQuery({
  queryKey: computed(() => ['coexistencia', 'conducao', setor.value]),
  queryFn: () => lerConducao(setor.value),
  enabled: computed(() => !!setor.value),
});
const opcoesSetor = computed(() => [
  { valor: '', rotulo: t('coexistencia.conducao.escolha') },
  // Os setores do catálogo das ondas (o gestor de acessos não precisa da tela de setores do comitê).
  ...SETORES_PRONTIDAO.map((s) => ({ valor: s.id, rotulo: s.nome })),
]);
const podeRetirar = computed(() => permissoes.value.has('acesso.opcao.revogar'));
const podeDevolver = computed(() => permissoes.value.has('acesso.opcao.conceder'));
const escolhidos = ref<string[]>([]);
const decididos = ref<string[]>([]);
const form = reactive({ autorizacao: '', senha: '' });
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const chave = (g: string, o: number) => `${g.toUpperCase()}:${o}`;

async function retirar(): Promise<void> {
  erro.value = null;
  try {
    const pares = (consulta.data.value?.pares ?? [])
      .filter((p) => escolhidos.value.includes(chave(p.grupo, p.opcao)))
      .map((p) => ({ grupo: p.grupo, opcao: p.opcao }));
    const r = await retirarConducao(setor.value, {
      pares,
      autorizacao: form.autorizacao,
      decisaoGestor: decididos.value,
      senha: form.senha,
    });
    form.senha = '';
    escolhidos.value = [];
    mensagem.value = t('coexistencia.conducao.retiradas', { n: r.feitas, grupos: r.grupos.join(', ') });
    await cliente.invalidateQueries({ queryKey: ['coexistencia', 'conducao'] });
  } catch (e) {
    erro.value = e;
  }
}

async function devolver(): Promise<void> {
  erro.value = null;
  try {
    const r = await devolverConducao(setor.value, form.senha);
    form.senha = '';
    mensagem.value = t('coexistencia.conducao.devolvidas', { n: r.feitas });
    await cliente.invalidateQueries({ queryKey: ['coexistencia', 'conducao'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="titulo-conducao" data-testid="tela-migracao-conducao">
    <h1 id="titulo-conducao">{{ t('coexistencia.conducao.titulo') }}</h1>
    <AbasMigracao atual="conducao" />
    <p>{{ t('coexistencia.conducao.texto') }}</p>
    <form class="filtros" :aria-label="t('coexistencia.filtros')" @submit.prevent>
      <SanteSelecao
        id="conducao-setor"
        v-model="setor"
        :rotulo="t('coexistencia.setor')"
        :opcoes="opcoesSetor"
        data-testid="conducao-setor"
      />
    </form>
    <MensagemErro v-if="consulta.error.value" :erro="consulta.error.value" />
    <template v-else-if="consulta.data.value">
      <SanteAlerta
        v-if="!consulta.data.value.conducaoLigada"
        :texto="t('coexistencia.conducao.desligada')"
        variante="aviso"
        data-testid="conducao-desligada"
      />
      <p data-testid="conducao-resumo">
        {{
          t('coexistencia.conducao.resumo', {
            ops: consulta.data.value.operacoes.length,
            pares: consulta.data.value.pares.length,
            retiradas: consulta.data.value.retiradas,
          })
        }}
      </p>
      <p v-if="consulta.data.value.pares.length === 0">{{ t('coexistencia.conducao.nenhumPar') }}</p>
      <table v-else class="tabela" data-testid="tabela-conducao">
        <caption>
          {{
            t('coexistencia.conducao.lista')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('coexistencia.conducao.retirar') }}</th>
            <th scope="col">{{ t('coexistencia.conducao.grupo') }}</th>
            <th scope="col">{{ t('coexistencia.conducao.opcao') }}</th>
            <th scope="col">{{ t('coexistencia.conducao.noSetor') }}</th>
            <th scope="col">{{ t('coexistencia.conducao.fora') }}</th>
            <th scope="col">{{ t('coexistencia.situacao') }}</th>
            <th scope="col">{{ t('coexistencia.conducao.decisao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in consulta.data.value.pares"
            :key="`${p.grupo}-${p.opcao}`"
            :data-testid="`par-${p.grupo}-${p.opcao}`"
          >
            <td>
              <input
                v-if="p.situacao === 'proposta'"
                :id="`escolher-${p.grupo}-${p.opcao}`"
                v-model="escolhidos"
                type="checkbox"
                :value="chave(p.grupo, p.opcao)"
                :aria-label="t('coexistencia.conducao.escolher', { grupo: p.grupo, opcao: p.opcao })"
                :data-testid="`escolher-${p.grupo}-${p.opcao}`"
              />
            </td>
            <th scope="row">{{ p.grupo }}</th>
            <td>{{ p.titulo ? `${p.opcao} — ${p.titulo}` : p.opcao }}</td>
            <td>{{ p.usuariosNoSetor }}</td>
            <td :class="{ alerta: p.usuariosFora > 0 }">{{ p.usuariosFora }}</td>
            <td data-testid="situacao-par">{{ t(`coexistencia.conducao.situacoes.${p.situacao}`) }}</td>
            <td>
              <input
                v-if="p.exigeDecisao && p.situacao === 'proposta'"
                v-model="decididos"
                type="checkbox"
                :value="chave(p.grupo, p.opcao)"
                :aria-label="t('coexistencia.conducao.decidir', { grupo: p.grupo, opcao: p.opcao })"
              />
              <span v-else>—</span>
            </td>
          </tr>
        </tbody>
      </table>
      <form v-if="podeRetirar || podeDevolver" class="filtros" data-testid="form-conducao" @submit.prevent>
        <SanteCampoTexto
          v-model="form.autorizacao"
          :rotulo="t('coexistencia.conducao.autorizacao')"
          :max-bytes="200"
          data-testid="conducao-autorizacao"
        />
        <div class="campo">
          <label for="conducao-senha">{{ t('coexistencia.senha') }}</label>
          <input
            id="conducao-senha"
            v-model="form.senha"
            type="password"
            autocomplete="current-password"
            data-testid="conducao-senha"
          />
        </div>
        <SanteBotao
          v-if="podeRetirar"
          :rotulo="t('coexistencia.conducao.retirarLote')"
          variante="destrutivo"
          :confirmacao="t('coexistencia.conducao.confirmar')"
          data-testid="conducao-retirar"
          @acionar="retirar"
        />
        <SanteBotao
          v-if="podeDevolver && consulta.data.value.retiradas > 0"
          :rotulo="t('coexistencia.conducao.devolver')"
          variante="secundario"
          data-testid="conducao-devolver"
          @acionar="devolver"
        />
      </form>
    </template>
    <SanteAlerta v-if="mensagem" :texto="mensagem" variante="info" anunciar data-testid="mensagem-conducao" />
    <MensagemErro v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
