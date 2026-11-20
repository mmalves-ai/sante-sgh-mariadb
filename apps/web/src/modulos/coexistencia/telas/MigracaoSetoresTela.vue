<script setup lang="ts">
// Migração gradual: setores (M37, ficha seção 7; figura 32.3 do m32): por estabelecimento, cada setor com a onda, a
// situação, as pessoas, as treinadas, as que já têm acesso, a parcela feita no novo (impressa com a conta) e a proposta
// de setor migrado (regra 10). O comitê muda a situação (um passo por vez; recuar é imediato) e aplica o lote de
// liberação de uma vez (setor inteiro, grupo ou lista de usuários; quem não concluiu a trilha fica de fora e aparece
// listado) e o recolhe inteiro. DP-4: o segundo estabelecimento aparece "aguardando" até tudo pronto no primeiro.
import type { PainelSetores, SetorCoex, SituacaoSetorCoex, TipoAlvoLote } from '@sgh/contratos';
import { SITUACOES_SETOR_COEX } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { aplicarLote, editarSetor, lerSetores, recolherLote, textoParcela } from '../api.js';
import AbasMigracao from '../componentes/AbasMigracao.vue';

const { t } = useI18n();
const { permissoes } = usarSessao();
const cliente = useQueryClient();
const consulta = useQuery({ queryKey: ['coexistencia', 'setores'], queryFn: lerSetores });
const painel = computed<PainelSetores | undefined>(() => consulta.data.value);
const podeEditar = computed(() => permissoes.value.has('config.coexistenciaSetor.editar'));
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const aberto = ref<string | null>(null);
const editar = reactive({
  situacao: 'legado' as SituacaoSetorCoex,
  justificativa: '',
  conducao: false,
  aceite: false,
  grupos: '',
});
const lote = reactive({
  tipo: 'setor' as TipoAlvoLote,
  valores: '',
  justificativa: '',
  autorizacao: '',
  senha: '',
});
const ultimoLote = ref<{ id: string; fora: { login: string; motivo: string }[] } | null>(null);
/** M39: o que falta na lista para ligar o setor da onda 1 (em dev/ci o lote segue; fora, é recusado). */
const avisoLigar = ref<string | null>(null);
const recolher = reactive({ justificativa: '', senha: '' });

const opcoesSituacao = SITUACOES_SETOR_COEX.map((s) => ({
  valor: s,
  rotulo: t(`coexistencia.situacoes.${s}`),
}));
const opcoesAlvo = (['setor', 'grupo', 'usuarios'] as const).map((a) => ({
  valor: a,
  rotulo: t(`coexistencia.alvos.${a}`),
}));
const setorAberto = computed<SetorCoex | null>(
  () => painel.value?.setores.find((s) => s.codigo === aberto.value) ?? null,
);

function abrir(s: SetorCoex): void {
  aberto.value = s.codigo;
  editar.situacao = s.situacao;
  editar.justificativa = '';
  editar.conducao = s.conducao;
  editar.aceite = s.aceiteCoordenador;
  editar.grupos = s.composicao
    .filter((c) => c.tipo === 'grupo')
    .map((c) => c.valor)
    .join(', ');
  mensagem.value = null;
  erro.value = null;
  ultimoLote.value = null;
}

async function recarregar(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['coexistencia'] });
}

async function gravarSetor(): Promise<void> {
  const s = setorAberto.value;
  if (!s) return;
  erro.value = null;
  try {
    const grupos = editar.grupos
      .split(/[,;\n]/)
      .map((x) => x.trim())
      .filter(Boolean);
    await editarSetor(s.codigo, {
      situacao: editar.situacao,
      justificativa: editar.justificativa,
      conducao: editar.conducao,
      aceiteCoordenador: editar.aceite,
      composicao: [
        ...s.composicao.filter((c) => c.tipo !== 'grupo'),
        ...grupos.map((valor) => ({ tipo: 'grupo' as const, valor })),
      ],
    });
    mensagem.value = t('coexistencia.setores.gravado');
    await recarregar();
  } catch (e) {
    erro.value = e;
  }
}

async function liberarLote(): Promise<void> {
  const s = setorAberto.value;
  if (!s) return;
  erro.value = null;
  try {
    const r = await aplicarLote({
      setor: s.codigo,
      alvo: {
        tipo: lote.tipo,
        valores:
          lote.tipo === 'setor'
            ? []
            : lote.valores
                .split(/[,;\n]/)
                .map((x) => x.trim())
                .filter(Boolean),
      },
      justificativa: lote.justificativa,
      ...(lote.autorizacao ? { referenciaAutorizacao: lote.autorizacao } : {}),
      senha: lote.senha,
    });
    lote.senha = '';
    ultimoLote.value = { id: r.lote, fora: r.fora };
    avisoLigar.value = r.avisoLigar ?? null;
    mensagem.value = t('coexistencia.setores.loteAplicado', {
      lote: r.lote,
      n: r.incluidos.length,
      fora: r.fora.length,
    });
    await recarregar();
  } catch (e) {
    erro.value = e;
  }
}

async function recolherUm(id: string): Promise<void> {
  erro.value = null;
  try {
    const r = await recolherLote(id, recolher.justificativa, recolher.senha);
    recolher.senha = '';
    mensagem.value = t('coexistencia.setores.loteRecolhido', { lote: id, n: r.alteradas });
    await recarregar();
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="titulo-migracao" data-testid="tela-migracao-setores">
    <h1 id="titulo-migracao">{{ t('coexistencia.titulo') }}</h1>
    <AbasMigracao atual="setores" />
    <p>{{ t('coexistencia.setores.texto') }}</p>
    <MensagemErro v-if="consulta.error.value" :erro="consulta.error.value" />
    <p v-else-if="!painel" role="status">{{ t('coexistencia.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="painel.aguardandoPrimeiro"
        :texto="painel.motivoAguardando ?? ''"
        variante="aviso"
        data-testid="migracao-aguardando"
      />
      <p data-testid="migracao-publico">
        {{
          t('coexistencia.setores.publico', {
            total: painel.publico.total,
            parcelas: painel.publico.parcelas
              .filter((p) => p.usuarios > 0)
              .map((p) => `${p.nome} ${p.usuarios}`)
              .join(' + '),
          })
        }}
        <span v-if="painel.publico.referencia !== null">{{
          t('coexistencia.setores.referencia', { n: painel.publico.referencia })
        }}</span>
      </p>
      <table class="tabela" data-testid="tabela-setores">
        <caption>
          {{
            t('coexistencia.setores.legenda')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('coexistencia.setor') }}</th>
            <th scope="col">{{ t('coexistencia.onda') }}</th>
            <th scope="col">{{ t('coexistencia.situacao') }}</th>
            <th scope="col">{{ t('coexistencia.setores.pessoas') }}</th>
            <th scope="col">{{ t('coexistencia.setores.treinados') }}</th>
            <th scope="col">{{ t('coexistencia.setores.comAcesso') }}</th>
            <th scope="col">{{ t('coexistencia.setores.parcela') }}</th>
            <th scope="col">{{ t('coexistencia.setores.migrado') }}</th>
            <th v-if="podeEditar" scope="col">
              <span class="sgh-visualmente-oculto">{{ t('coexistencia.acoes') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in painel.setores" :key="s.codigo" :data-testid="`setor-${s.codigo}`">
            <th scope="row">{{ s.nome }}</th>
            <td>{{ s.onda }}</td>
            <td data-testid="situacao">{{ t(`coexistencia.situacoes.${s.situacao}`) }}</td>
            <td>{{ s.pessoas }}</td>
            <td data-testid="treinados">{{ s.treinados }}</td>
            <td data-testid="com-acesso">{{ s.comAcesso }}</td>
            <td data-testid="parcela">{{ textoParcela(s.parcela) }}</td>
            <td>
              {{
                s.migrado.cumprido
                  ? t('coexistencia.sim')
                  : t('coexistencia.setores.faltam', {
                      n: s.migrado.criterios.filter((c) => !c.atendido).length,
                    })
              }}
            </td>
            <td v-if="podeEditar">
              <SanteBotao
                :rotulo="t('coexistencia.setores.gerir')"
                variante="texto"
                :data-testid="`gerir-${s.codigo}`"
                @acionar="abrir(s)"
              />
            </td>
          </tr>
        </tbody>
      </table>

      <section
        v-if="setorAberto"
        class="painel-setor"
        aria-labelledby="titulo-setor"
        data-testid="painel-setor"
      >
        <h2 id="titulo-setor">{{ setorAberto.nome }}</h2>
        <ul data-testid="criterios-migrado">
          <li v-for="c in setorAberto.migrado.criterios" :key="c.criterio">
            {{ t(`coexistencia.criterios.${c.criterio}`) }}:
            {{ c.atendido ? t('coexistencia.sim') : t('coexistencia.nao') }} ({{ c.detalhe }})
          </li>
        </ul>
        <form class="filtros" data-testid="form-setor" @submit.prevent="gravarSetor">
          <SanteSelecao
            id="setor-situacao"
            v-model="editar.situacao"
            :rotulo="t('coexistencia.situacao')"
            :opcoes="opcoesSituacao"
            data-testid="setor-situacao"
          />
          <div class="campo">
            <label for="setor-grupos">{{ t('coexistencia.setores.grupos') }}</label>
            <input id="setor-grupos" v-model="editar.grupos" data-testid="setor-grupos" />
          </div>
          <div class="campo">
            <label
              ><input v-model="editar.conducao" type="checkbox" data-testid="setor-conducao" />
              {{ t('coexistencia.setores.usaConducao') }}</label
            >
            <label
              ><input v-model="editar.aceite" type="checkbox" data-testid="setor-aceite" />
              {{ t('coexistencia.setores.aceite') }}</label
            >
          </div>
          <SanteCampoTexto
            v-model="editar.justificativa"
            :rotulo="t('coexistencia.justificativa')"
            :max-bytes="200"
            obrigatorio
            data-testid="setor-justificativa"
          />
          <SanteBotao
            :rotulo="t('coexistencia.gravar')"
            variante="primario"
            tipo="submit"
            data-testid="setor-gravar"
          />
        </form>

        <h3>{{ t('coexistencia.setores.lote') }}</h3>
        <p>
          {{
            t('coexistencia.setores.loteTexto', {
              chaves: setorAberto.chaves.map((k) => k.chave).join(', ') || '—',
            })
          }}
        </p>
        <form class="filtros" data-testid="form-lote" @submit.prevent="liberarLote">
          <SanteSelecao
            id="lote-alvo"
            v-model="lote.tipo"
            :rotulo="t('coexistencia.setores.alvo')"
            :opcoes="opcoesAlvo"
            data-testid="lote-alvo"
          />
          <div v-if="lote.tipo !== 'setor'" class="campo">
            <label for="lote-valores">{{ t('coexistencia.setores.valores') }}</label>
            <textarea id="lote-valores" v-model="lote.valores" rows="2" data-testid="lote-valores" />
          </div>
          <SanteCampoTexto
            v-model="lote.justificativa"
            :rotulo="t('coexistencia.justificativa')"
            :max-bytes="200"
            obrigatorio
            data-testid="lote-justificativa"
          />
          <SanteCampoTexto
            v-model="lote.autorizacao"
            :rotulo="t('coexistencia.setores.autorizacao')"
            :max-bytes="200"
            data-testid="lote-autorizacao"
          />
          <div class="campo">
            <label for="lote-senha">{{ t('coexistencia.senha') }}</label>
            <input
              id="lote-senha"
              v-model="lote.senha"
              type="password"
              autocomplete="current-password"
              required
              data-testid="lote-senha"
            />
          </div>
          <SanteBotao
            :rotulo="t('coexistencia.setores.aplicarLote')"
            variante="primario"
            tipo="submit"
            data-testid="lote-aplicar"
          />
        </form>
        <SanteAlerta
          v-if="avisoLigar"
          :texto="t('coexistencia.onda1.avisoLote', { motivo: avisoLigar })"
          variante="aviso"
          data-testid="lote-aviso-ligar"
        />
        <section
          v-if="ultimoLote && ultimoLote.fora.length"
          aria-labelledby="titulo-fora"
          data-testid="lote-fora"
        >
          <h4 id="titulo-fora">{{ t('coexistencia.setores.fora', { n: ultimoLote.fora.length }) }}</h4>
          <ul>
            <li v-for="f in ultimoLote.fora" :key="f.login">{{ f.login }}: {{ f.motivo }}</li>
          </ul>
        </section>
      </section>

      <SanteAlerta
        v-if="mensagem"
        :texto="mensagem"
        variante="info"
        anunciar
        data-testid="mensagem-migracao"
      />
      <MensagemErro v-if="erro" :erro="erro" />

      <section aria-labelledby="titulo-lotes" data-testid="lotes">
        <h2 id="titulo-lotes">{{ t('coexistencia.setores.lotes') }}</h2>
        <p v-if="painel.lotes.length === 0">{{ t('coexistencia.nenhum') }}</p>
        <template v-else>
          <form v-if="podeEditar" class="filtros" @submit.prevent>
            <SanteCampoTexto
              v-model="recolher.justificativa"
              :rotulo="t('coexistencia.setores.motivoRecolher')"
              :max-bytes="200"
              data-testid="recolher-justificativa"
            />
            <div class="campo">
              <label for="recolher-senha">{{ t('coexistencia.senha') }}</label>
              <input
                id="recolher-senha"
                v-model="recolher.senha"
                type="password"
                autocomplete="current-password"
                data-testid="recolher-senha"
              />
            </div>
          </form>
          <table class="tabela">
            <caption>
              {{
                t('coexistencia.setores.lotes')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('coexistencia.setores.numero') }}</th>
                <th scope="col">{{ t('coexistencia.setor') }}</th>
                <th scope="col">{{ t('coexistencia.setores.alvo') }}</th>
                <th scope="col">{{ t('coexistencia.setores.incluidos') }}</th>
                <th scope="col">{{ t('coexistencia.situacao') }}</th>
                <th v-if="podeEditar" scope="col">
                  <span class="sgh-visualmente-oculto">{{ t('coexistencia.acoes') }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="l in painel.lotes" :key="l.id" :data-testid="`lote-${l.id}`">
                <td>{{ l.id }}</td>
                <td>{{ l.setor }}</td>
                <td>{{ t(`coexistencia.alvos.${l.alvoTipo}`) }}</td>
                <td>{{ l.incluidos }} ({{ t('coexistencia.setores.foraCurto', { n: l.fora }) }})</td>
                <td>{{ t(`coexistencia.lote.${l.situacao}`) }}</td>
                <td v-if="podeEditar">
                  <SanteBotao
                    v-if="l.situacao === 'aplicado'"
                    :rotulo="t('coexistencia.setores.recolher')"
                    variante="secundario"
                    :data-testid="`recolher-${l.id}`"
                    @acionar="recolherUm(l.id)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </template>
      </section>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
